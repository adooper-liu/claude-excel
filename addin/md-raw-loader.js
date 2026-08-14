"use strict";

/** Turn SKILL.md into `export default "..."` so webpack never parses markdown as JS. */
module.exports = function mdRawLoader(source) {
  const text = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
  return "export default " + JSON.stringify(text) + ";";
};
