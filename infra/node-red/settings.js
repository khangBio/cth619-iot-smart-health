module.exports = {
  uiPort: 1880,
  credentialSecret: false,
  functionGlobalContext: {},
  editorTheme: { projects: { enabled: false } },
  // Editor is exposed on localhost only by compose. Add adminAuth + TLS before remote use.
  logging: { console: { level: 'info', metrics: false, audit: true } },
};
