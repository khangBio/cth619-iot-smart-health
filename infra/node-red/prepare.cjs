const fs = require('node:fs');
// The image can seed root-owned files in the writable /data volume.
// Replace entries atomically instead of opening those files for overwrite.
const replace = (name, content, mode = 0o600) => {
  const target = `/data/${name}`;
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, target);
};
replace('flows.json', fs.readFileSync('/config/flows.json'));
replace(
  'flows_cred.json',
  JSON.stringify({ broker: { user: 'platform', password: process.env.MQTT_PASSWORD } })
);
