const fs = require('node:fs');
const path = require('node:path');
function dashboardNodes() {
  const read = (file) => fs.readFileSync(path.join(__dirname, 'dashboard', file), 'utf8');
  const component = read('component.vue')
    .replace('/*__VISUALS__*/', read('visuals.js'))
    .replace('/*__STYLES__*/', read('styles.css'));
  const nodes = [
    {
      id: 'ff-health-flow',
      type: 'tab',
      label: 'VitalCare · FlowFuse Dashboard',
      disabled: false,
      info: 'Giao diện FlowFuse; dữ liệu riêng từng phiên đăng nhập qua /health-api. Không phát dữ liệu bệnh nhân qua msg/socket chung.',
    },
    {
      id: 'ff-health-base',
      type: 'ui-base',
      name: 'VitalCare',
      path: '/dashboard',
      appIcon: 'mdi-heart-pulse',
      includeClientData: true,
      acceptsClientConfig: ['ui-template'],
      showPathInSidebar: false,
      navigationStyle: 'default',
      titleBarStyle: 'default',
      showReconnectNotification: true,
      notificationDisplayTime: 3,
      showDisconnectNotification: true,
      allowInstall: false,
    },
    {
      id: 'ff-health-theme',
      type: 'ui-theme',
      name: 'VitalCare Light',
      colors: {
        surface: '#ffffff',
        primary: '#007f75',
        bgPage: '#f4f7fa',
        groupBg: '#f4f7fa',
        groupOutline: '#f4f7fa',
      },
      sizes: {
        density: 'default',
        pagePadding: '12px',
        groupGap: '12px',
        groupBorderRadius: '8px',
        widgetGap: '12px',
      },
    },
  ];
  [
    ['overview', 'Tổng quan', 'view-dashboard'],
    ['patient', 'Theo dõi bệnh nhân', 'heart-pulse'],
    ['workflow', 'Yêu cầu chăm sóc', 'clipboard-check-outline'],
    ['devices', 'Thiết bị IoT', 'access-point'],
    ['emr', 'Đồng bộ EMR', 'database-check-outline'],
    ['settings', 'Quản trị', 'cog-outline'],
  ].forEach(([key, title, icon], i) => {
    nodes.push(
      {
        id: 'ff-health-page-' + key,
        type: 'ui-page',
        name: title,
        ui: 'ff-health-base',
        path: '/' + key,
        icon,
        layout: 'grid',
        theme: 'ff-health-theme',
        order: i + 1,
        className: 'health-flowfuse-page',
        visible: true,
        disabled: false,
        breakpoints: [
          { name: 'Default', px: '0', cols: '3' },
          { name: 'Tablet', px: '576', cols: '6' },
          { name: 'Desktop', px: '1024', cols: '12' },
        ],
      },
      {
        id: 'ff-health-group-' + key,
        type: 'ui-group',
        name: title,
        page: 'ff-health-page-' + key,
        width: '12',
        height: '1',
        order: 1,
        showTitle: false,
        className: 'health-flowfuse-group',
        visible: 'true',
        disabled: 'false',
        groupType: 'default',
      },
      {
        id: 'ff-health-view-' + key,
        type: 'ui-template',
        z: 'ff-health-flow',
        group: 'ff-health-group-' + key,
        page: '',
        ui: '',
        name: title,
        order: 1,
        width: 12,
        height: 0,
        head: '',
        format: component.replaceAll('__PAGE__', key).replaceAll('__TITLE__', title),
        storeOutMessages: false,
        passthru: false,
        resendOnRefresh: false,
        templateScope: 'local',
        className: 'health-flowfuse-view',
        x: 250,
        y: 80 + i * 70,
        wires: [[]],
      }
    );
  });
  return nodes;
}
module.exports = { dashboardNodes };
if (require.main === module) {
  fs.writeFileSync(
    path.join(__dirname, 'dashboard-flow.json'),
    JSON.stringify(dashboardNodes(), null, 2) + '\n'
  );
  console.log('Generated FlowFuse dashboard-flow.json (6 pages)');
}
