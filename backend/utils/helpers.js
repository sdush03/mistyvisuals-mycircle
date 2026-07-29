const installAuthHelpers = require('./authHelpers');
const installFormattingHelpers = require('./formattingHelpers');
const installFiscalHelpers = require('./fiscalHelpers');
const installLeadHelpers = require('./leadHelpers');

module.exports = function installHelpers(opts) {
  const authHelpers = installAuthHelpers(opts);
  const formattingHelpers = installFormattingHelpers(opts);
  const fiscalHelpers = installFiscalHelpers(opts);
  const leadHelpers = installLeadHelpers({ ...opts, boolToYesNo: formattingHelpers.boolToYesNo });

  return {
    ...authHelpers,
    ...formattingHelpers,
    ...fiscalHelpers,
    ...leadHelpers,
    requireVendor: (req, reply) => authHelpers.requireVendor(req, reply, opts.pool),
    resolveUserDisplayName: (name) => leadHelpers.resolveUserDisplayName(name, formattingHelpers.getUserDisplayName),
  };
};
