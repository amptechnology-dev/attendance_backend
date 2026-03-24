export async function validateUniqueFields(model, fields) {
  for (let field in fields) {
    const value = fields[field];
    if (value !== null && value !== undefined && value !== '') {
      const exists = await model.findOne({ [field]: value });
      if (exists) {
        return field; // Return the field name if a duplicate is found
      }
    }
  }
  return;
}
