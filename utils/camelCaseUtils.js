function isCamelCase(name) {
  return /^[a-z][a-zA-Z0-9]*$/.test(name);
}

function toCamelCase(name) {
  return name
    .replace(/[_-](.)/g, (_, g) => g.toUpperCase()) // snake_case > camelCase
    .replace(/^[A-Z]/, (c) => c.toLowerCase()); // PascalCase > camelCase
}

module.exports = {
  isCamelCase,
  toCamelCase,
};