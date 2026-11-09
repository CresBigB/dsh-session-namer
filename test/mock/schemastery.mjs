// Minimal chainable stub for the schemastery surface used by index.js.
const chain = () => {
  const schema = {};
  for (const method of ["step", "min", "max", "required", "default", "description", "hidden"]) {
    schema[method] = () => schema;
  }
  return schema;
};

const z = {
  number: () => chain(),
  string: () => chain(),
  boolean: () => chain(),
  array: () => chain(),
  object: () => chain(),
  union: () => chain(),
  any: () => chain(),
};

export default z;
