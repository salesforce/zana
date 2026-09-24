import qr from 'qrcode-terminal';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import { MobileDeviceStore } from '../apps/server/src/mobile/device-store.js';

const { values } = parseArgs({
  options: {
    upstream: { type: 'string', default: 'http://127.0.0.1:8780' },
    'public-url': { type: 'string', default: 'http://127.0.0.1:8785' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8785' },
    'data-dir': { type: 'string', default: join(homedir(), '.zcc', 'mobile') },
    help: { type: 'boolean', default: false }
  }
});
if (values.help) {
  console.log(
    'Zana mobile gateway\n\npnpm mobile:serve --public-url https://your-mac.example --upstream http://127.0.0.1:8780\n\nKeep Zana running. Point your authenticated HTTPS reverse proxy or Tailscale Serve at 127.0.0.1:8785.\nUse --host <LAN-IP> --public-url http://<LAN-IP>:8785 only on a trusted private network.\nInteractive commands: pair, devices, revoke <device-id>, quit.'
  );
} else {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const gateway = await startMobileGateway({
    upstream: values.upstream!,
    publicUrl: values['public-url']!,
    host: values.host,
    port,
    devices: new MobileDeviceStore(join(values['data-dir']!, 'devices.json'))
  });
  const pair = () => {
    const payload = gateway.pair();
    console.log('\nPair Zana Mobile (expires in 5 minutes, single use):');
    qr.generate(JSON.stringify(payload), { small: true });
    console.log(`Server: ${payload.serverUrl}\nCode: ${payload.code}`);
    console.log(`Link: zana://connect?payload=${encodeURIComponent(JSON.stringify(payload))}`);
    console.log(`QR payload: ${JSON.stringify(payload)}\n`);
  };
  console.log(
    `Zana Mobile gateway on ${values.host}:${gateway.port}. Commands: pair, devices, revoke <id>, quit.`
  );
  pair();
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    input.close();
    await gateway.close();
  };
  input.on('line', (line) => {
    const command = line.trim();
    if (command === 'pair') pair();
    else if (command === 'devices') console.table(gateway.devices());
    else if (command.startsWith('revoke '))
      console.log(
        gateway.revoke(command.slice(7).trim()) ? 'Device revoked.' : 'Device not found.'
      );
    else if (command === 'quit') void stop();
  });
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
