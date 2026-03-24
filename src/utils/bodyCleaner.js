/**
 * Removes empty strings and null values from an object
 * @param {Object} obj - The input object to clean
 * @returns {Object} A new object with empty strings and null values removed
 * @example
 * cleanObject({ name: "", age: null, city: "Paris" })
 * // returns { city: "Paris" }
 */
const cleanObject = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (value !== '' && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

export default cleanObject;
