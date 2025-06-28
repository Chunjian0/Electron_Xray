import sys
import base64
import json
import subprocess
from urllib.parse import urlparse, parse_qs, unquote
import urllib.request
import io

# Set stdout to handle unicode properly
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def detect_link_type(link):
    if link.startswith('vmess://'):
        return 'vmess'
    elif link.startswith('trojan://'):
        return 'trojan'
    elif link.startswith('vless://'):
        return 'vless'
    elif link.startswith('ss://'):
        return 'shadowsocks'
    else:
        return None

def parse_vmess_link(link):
    encoded = link[8:]
    encoded += '=' * (-len(encoded) % 4)
    decoded = base64.urlsafe_b64decode(encoded).decode('utf-8')
    return json.loads(decoded)

def parse_trojan_link(link):
    parsed = urlparse(link)
    password, netloc = parsed.netloc.split('@') if '@' in parsed.netloc else (parsed.netloc, '')
    address, port = netloc.split(':') if ':' in netloc else (netloc, '443')
    params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    remarks = unquote(parsed.fragment)
    return {
        'password': password,
        'address': address,
        'port': int(port),
        'params': params,
        'remarks': remarks
    }

def parse_vless_link(link):
    parsed = urlparse(link)
    uuid, netloc = parsed.netloc.split('@') if '@' in parsed.netloc else (parsed.netloc, '')
    address, port = netloc.split(':') if ':' in netloc else (netloc, '443')
    params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    remarks = unquote(parsed.fragment)
    return {
        'uuid': uuid,
        'address': address,
        'port': int(port),
        'params': params,
        'remarks': remarks
    }

def parse_ss_link(link):
    ss_link = link[5:]
    main_part, remarks = ss_link.split('#', 1) if '#' in ss_link else (ss_link, '')
    remarks = unquote(remarks)
    if '@' not in main_part:
        main_part += '=' * (-len(main_part) % 4)
        decoded = base64.urlsafe_b64decode(main_part).decode('utf-8')
    else:
        decoded = main_part
    method_pass, server_port = decoded.split('@') if '@' in decoded else ('', '')
    method, password = method_pass.split(':', 1)
    server, port = server_port.split(':', 1)
    return {
        'method': method,
        'password': password,
        'server': server,
        'port': int(port),
        'remarks': remarks
    }

def generate_config(protocol, config_data):
    base = {
        "log": {"loglevel": "warning"},
        "inbounds": [{
            "port": 20809,
            "listen": "127.0.0.1",
            "protocol": "http",
            "settings": {"auth": "noauth", "udp": True},
            "sniffing": {"enabled": True, "destOverride": ["http", "tls"]}
        }],
        "outbounds": [],
        "routing": {
            "rules": [
                {"type": "field", "outboundTag": "proxy", "domain": ["geosite:geolocation-!cn"]},
                {"type": "field", "outboundTag": "direct", "domain": ["geosite:cn"]},
                {"type": "field", "outboundTag": "direct", "ip": ["geoip:cn", "geoip:private"]}
            ]
        }
    }

    if protocol == 'vmess':
        proxy = {
            "tag": "proxy",
            "protocol": "vmess",
            "settings": {
                "vnext": [{
                    "address": config_data['add'],
                    "port": int(config_data['port']),
                    "users": [{
                        "id": config_data['id'],
                        "alterId": int(config_data.get('aid', 0)),
                        "security": config_data.get('scy', 'auto')
                    }]
                }]
            },
            "streamSettings": {
                "network": config_data.get('net', 'tcp'),
                "security": config_data.get('tls', 'none'),
                f"{config_data.get('net', 'tcp')}Settings": {
                    "header": {"type": config_data.get('type', 'none')}
                }
            }
        }

    elif protocol == 'trojan':
        proxy = {
            "tag": "proxy",
            "protocol": "trojan",
            "settings": {
                "servers": [{
                    "address": config_data['address'],
                    "port": config_data['port'],
                    "password": config_data['password']
                }]
            },
            "streamSettings": {
                "network": config_data['params'].get('type', 'tcp'),
                "security": config_data['params'].get('security', 'none'),
                f"{config_data['params'].get('type', 'tcp')}Settings": {
                    "header": {"type": config_data['params'].get('headerType', 'none')}
                }
            }
        }

    elif protocol == 'vless':
        stream_type = config_data['params'].get('type', 'tcp')
        security_type = config_data['params'].get('security', 'none')
        proxy = {
            "tag": "proxy",
            "protocol": "vless",
            "settings": {
                "vnext": [{
                    "address": config_data['address'],
                    "port": config_data['port'],
                    "users": [{
                        "id": config_data['uuid'],
                        "encryption": config_data['params'].get('encryption', 'none'),
                        "flow": config_data['params'].get('flow', '')
                    }]
                }]
            },
            "streamSettings": {
                "network": stream_type,
                "security": security_type,
                **({"tlsSettings": {"serverName": config_data['address']}} if security_type == 'tls' else {}),
                **({"wsSettings": {
                    "path": config_data['params'].get('path', '/'),
                    "headers": {"Host": config_data['params'].get('host', config_data['address'])}
                }} if stream_type == 'ws' else {}),
                **({f"{stream_type}Settings": {
                    "header": {"type": config_data['params'].get('headerType', 'none')}
                }} if stream_type in ['tcp', 'kcp'] else {})
            }
        }

    elif protocol == 'shadowsocks':
        proxy = {
            "tag": "proxy",
            "protocol": "shadowsocks",
            "settings": {
                "servers": [{
                    "address": config_data['server'],
                    "port": config_data['port'],
                    "method": config_data['method'],
                    "password": config_data['password'],
                    "level": 1,
                    "ota": False
                }]
            },
            "streamSettings": {"network": "tcp", "security": "none"}
        }

    base["outbounds"] = [
        proxy,
        {"tag": "direct", "protocol": "freedom", "settings": {}},
        {"tag": "block", "protocol": "blackhole", "settings": {"response": {"type": "http"}}}
    ]
    return base

def extract_links_from_subscription(url):
    try:
        with urllib.request.urlopen(url) as response:
            content = response.read().decode('utf-8')
            decoded = base64.b64decode(content).decode('utf-8')
            lines = decoded.strip().split('\n')
            return [line for line in lines if detect_link_type(line)]
    except Exception as e:
        print(f"[ERROR] Failed to download or decode subscription: {e}")
        return []

def main():
    if len(sys.argv) < 2:
        print("[ERROR] Usage: python config_gen.py <link_or_subscription_url>")
        return

    raw_input = sys.argv[1]
    links = []

    if raw_input.startswith('http://') or raw_input.startswith('https://'):
        links = extract_links_from_subscription(raw_input)
        if not links:
            print("[ERROR] No valid links found in subscription.")
            return
    else:
        links = [raw_input]

    link = links[0]
    protocol = detect_link_type(link)

    if protocol == 'vmess':
        config_data = parse_vmess_link(link)
    elif protocol == 'trojan':
        config_data = parse_trojan_link(link)
    elif protocol == 'vless':
        config_data = parse_vless_link(link)
    elif protocol == 'shadowsocks':
        config_data = parse_ss_link(link)
    else:
        print("[ERROR] Unsupported or invalid link")
        return

    config = generate_config(protocol, config_data)
    with open('config.json', 'w') as f:
        json.dump(config, f, indent=2)
    print("[SUCCESS] config.json generated successfully")

if __name__ == '__main__':
    main()