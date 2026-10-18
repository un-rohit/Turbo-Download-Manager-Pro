import os from 'node:os';
import http from 'node:http';
import https from 'node:https';

/**
 * Categorizes an interface name into a human-friendly network type.
 */
export function categorizeInterface(name) {
  const lower = name.toLowerCase();
  if (lower.includes('wi-fi') || lower.includes('wlan') || lower.includes('wireless')) {
    return { type: 'wifi', label: 'Wi-Fi Adapter', icon: '📶' };
  }
  if (lower.includes('bluetooth') || lower.includes('bth') || lower.includes('pan')) {
    return { type: 'bluetooth', label: 'Bluetooth Network', icon: 'ᛒ' };
  }
  if (lower.includes('rndis') || lower.includes('usb') || lower.includes('tethering')) {
    return { type: 'usb', label: 'USB Tethering / Modem', icon: '🔌' };
  }
  if (lower.includes('vmware') || lower.includes('virtual') || lower.includes('vethernet') || lower.includes('loopback') || lower.includes('tap')) {
    return { type: 'virtual', label: 'Virtual Adapter', icon: '🖥️' };
  }
  if (lower.includes('ethernet') || lower.includes('lan') || lower.includes('eth')) {
    return { type: 'ethernet', label: 'Ethernet / LAN', icon: '🌐' };
  }
  return { type: 'other', label: name, icon: '🔗' };
}

/**
 * Tests whether an IP address can route outbound traffic.
 */
export function testInterfaceConnectivity(ipAddress, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const isIPv6 = ipAddress.includes(':');
    if (isIPv6) {
      // For now prioritize IPv4 for socket binding stability across Windows NICs
      return resolve(false);
    }

    const testUrl = 'http://connectivitycheck.gstatic.com/generate_204';
    const req = http.get(testUrl, {
      localAddress: ipAddress,
      family: 4,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'TurboDownloadManager-Probe/1.0' }
    }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
      res.resume();
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => {
      resolve(false);
    });
  });
}

export function isVirtualMachineInterface(name) {
  const lower = (name || '').toLowerCase();
  return (
    lower.includes('vmware') ||
    lower.includes('vmnet') ||
    lower.includes('virtualbox') ||
    lower.includes('vbox') ||
    lower.includes('hyper-v') ||
    lower.includes('vethernet') ||
    lower.includes('virtual') ||
    lower.includes('wsl') ||
    lower.includes('qemu') ||
    lower.includes('kvm') ||
    lower.includes('tap') ||
    lower.includes('tun') ||
    lower.includes('wireguard') ||
    lower.includes('openvpn') ||
    lower.includes('tailscale') ||
    lower.includes('zerotier') ||
    lower.includes('loopback') ||
    lower.includes('npcap') ||
    lower.includes('teredo') ||
    lower.includes('isatap')
  );
}

/**
 * Discovers and tests all available physical network interfaces (always ignoring VM adapters).
 */
export async function getNetworkInterfaces(verifyConnectivity = true) {
  const rawInterfaces = os.networkInterfaces();
  const detected = [];

  for (const [name, addrs] of Object.entries(rawInterfaces)) {
    if (!addrs) continue;
    // Always ignore virtual machine device networks
    if (isVirtualMachineInterface(name)) continue;

    for (const info of addrs) {
      // Exclude loopback and internal addresses
      if (info.internal) continue;
      // Focus on IPv4 for deterministic multi-homed binding
      if (info.family !== 'IPv4') continue;

      const meta = categorizeInterface(name);
      detected.push({
        name,
        address: info.address,
        netmask: info.netmask,
        mac: info.mac,
        type: meta.type,
        label: meta.label,
        icon: meta.icon,
        isVirtual: false,
        online: false
      });
    }
  }

  if (verifyConnectivity) {
    await Promise.all(
      detected.map(async (iface) => {
        // Skip virtual adapters by default unless user explicitly tests
        if (iface.isVirtual) {
          iface.online = false;
          return;
        }
        iface.online = await testInterfaceConnectivity(iface.address);
      })
    );
  } else {
    // Optimistic fallback
    detected.forEach(d => { d.online = !d.isVirtual; });
  }

  return detected;
}
