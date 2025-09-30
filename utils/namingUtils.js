function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

// ---- Case Validators ----
function isCamelCase(name) {
  return isNonEmptyString(name)
    && /^[a-z][a-zA-Z0-9]*$/.test(name) // Starts lowercase, valid chars
    && /[A-Z]/.test(name.slice(1)); // Has at least one uppercase letter
}

function isPascalCase(name) {
  return isNonEmptyString(name)
    && /^[A-Z][a-zA-Z0-9]*$/.test(name) // Starts uppercase, valid chars
    && /[a-z]/.test(name); // Has at least one lowercase letter
}

function isSnakeCase(name) {
  return isNonEmptyString(name)
    && /^[a-z]+(?:_[a-z0-9]+)+$/.test(name); // Must include at least one underscore
}

// ---- Case Transformers ----
function toCamelCase(name) {
  if (!isNonEmptyString(name)) return name;
  return name
    //.toLowerCase()
    .replace(/[_-]+(.)?/g, (_, g) => (g ? g.toUpperCase() : "")) // snake/kebab to camelCase
    .replace(/^[A-Z]/, (c) => c.toLowerCase()); // Ensure starts with lowercase
}

function toPascalCase(name) {
  if (!isNonEmptyString(name)) return name;
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Split camelCase words
    .replace(/[_-]+/g, " ") // Normalise snake/kebab to space
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function toSnakeCase(name) {
  if (!isNonEmptyString(name)) return name;
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // camelCase/PascalCase to snake_case
    .replace(/[-\s]+/g, "_") // Dashes/spaces to underscore
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1_$2") // Handle all-caps acronyms correctly
    .toLowerCase();
}

// ---- Exports ----
module.exports = {
  isCamelCase,
  toCamelCase,
  isPascalCase,
  toPascalCase,
  isSnakeCase,
  toSnakeCase,
};