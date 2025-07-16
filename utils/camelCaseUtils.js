function isCamelCase(name) {
  return (
    /^[a-z][a-zA-Z0-9]*$/.test(name) && // starts lowercase, valid chars
    /[A-Z]/.test(name.slice(1)) // has at least one uppercase later
  );
}

function toCamelCase(name) {
  return name
    .toLowerCase()
    .replace(/[_-]+(.)?/g, (_, g) => (g ? g.toUpperCase() : ""))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

module.exports = {
  isCamelCase,
  toCamelCase,
};