module.exports = {
  uiPort: 1880,
  // Load the declared Node-RED package only. Scanning all dependencies treats
  // tslib's HTML files as node definitions and stalls the editor's node loader.
  nodesDir: '/opt/health-dashboard/node_modules/@flowfuse/node-red-dashboard',
  // Admin root middleware receives /health-api before the editor's fallback route.
  // httpNodeMiddleware alone only applies to HTTP In nodes, not Dashboard routes.
  httpAdminMiddleware: require('./api-proxy.cjs')(),
  credentialSecret: false,
  functionGlobalContext: {},
  editorTheme: { projects: { enabled: false } },
  // Editor is exposed on localhost only by compose. Add adminAuth + TLS before remote use.
  logging: { console: { level: 'info', metrics: false, audit: true } },
};
