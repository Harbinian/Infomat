// Rendering an incomplete legacy submission must not fill its business facts.
// Keep the raw source for edits/baselines; absent collections are an empty view.
export function caseSubmissionCollections(input) {
  return {
    sources: Array.isArray(input?.sources) ? input.sources : [],
    participants: Array.isArray(input?.participants) ? input.participants : []
  };
}
