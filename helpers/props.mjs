const validators = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && !Number.isNaN(value),
  boolean: (value) => typeof value === "boolean",
  object: (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value),
  array: (value) => Array.isArray(value),
};

export function validateProps(schema, props) {
  const errors = [];
  for (const [key, rule] of Object.entries(schema || {})) {
    const value = props[key];
    const { required = false, type, validate } = rule;
    if (required && (value === undefined || value === null)) {
      errors.push(`Missing required prop: ${key}`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (type && validators[type] && !validators[type](value)) {
      errors.push(`Prop ${key} expected type ${type}`);
    }
    if (typeof validate === "function") {
      const result = validate(value);
      if (result === false) {
        errors.push(`Prop ${key} failed custom validation`);
      } else if (typeof result === "string") {
        errors.push(`Prop ${key}: ${result}`);
      }
    }
  }
  if (errors.length) {
    throw new Error(`Invalid props: ${errors.join("; ")}`);
  }
  return props;
}
