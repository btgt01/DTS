module.exports = {
  framework: 'static',
  staticHosting: {
    ignore: ['node_modules/**', '.git/**', 'server/**', 'cloudbase*.js', 'package*.json', '*.db', 'data/**', 'cloudbaserc.json', 'DEPLOY_*.md']
  }
};
