import { isMobileDevice, sibredAppUrl } from '#lib/family/app-login.ts';

describe(sibredAppUrl.name, () => {
  it('names the server and the code, encoded', () => {
    expect(sibredAppUrl('https://photos.example.com', 'abc-_123')).toBe(
      'sibred://app-login?server=https%3A%2F%2Fphotos.example.com&code=abc-_123',
    );
  });

  it('keeps a port in the server address', () => {
    expect(sibredAppUrl('http://192.168.1.2:2283', 'code')).toBe(
      'sibred://app-login?server=http%3A%2F%2F192.168.1.2%3A2283&code=code',
    );
  });
});

describe(isMobileDevice.name, () => {
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

  it('knows a phone', () => {
    expect(isMobileDevice(iPhone, 5)).toBe(true);
  });

  it('knows an iPad asking for the desktop site', () => {
    expect(isMobileDevice(mac, 5)).toBe(true);
  });

  it('treats a computer as a computer', () => {
    expect(isMobileDevice(mac, 0)).toBe(false);
    expect(isMobileDevice(windows, 0)).toBe(false);
  });
});
