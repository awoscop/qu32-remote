// Android 7+ ignores user-installed CAs unless the app opts in. The gateway uses a private local CA
// (installed on the phone by the engineer), so trust system + user CAs. Cleartext HTTP stays blocked.
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

module.exports = function withUserCertificateTrust(config) {
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "network_security_config.xml"), XML);
      return cfg;
    },
  ]);
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest.application[0].$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return cfg;
  });
};
