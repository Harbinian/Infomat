// One owner for a lazily verified repository and its pool. Construction performs no IO.
function createRepositoryResource({create,verify,build,dispose=pool=>pool.end()}) {
  let current = null;
  async function close(entry) {
    if (!entry.pool || entry.closed) return;
    entry.closed = true;
    await dispose(entry.pool);
  }
  function get() {
    if (current) return current.promise;
    const entry = {pool:null,closed:false};
    current = entry;
    entry.promise = Promise.resolve().then(async () => {
      try {
        entry.pool = await create();
        await verify(entry.pool);
        if (current !== entry) throw new Error('REPOSITORY_RESOURCE_REPLACED');
        const repository = await build(entry.pool);
        if (current !== entry) throw new Error('REPOSITORY_RESOURCE_REPLACED');
        return repository;
      } catch (error) {
        if (current === entry) current = null;
        await close(entry).catch(()=>{});
        throw error;
      }
    });
    return entry.promise;
  }
  function reset() {
    const previous = current;
    current = null;
    if (!previous) return Promise.resolve();
    return previous.promise.catch(()=>{}).then(()=>close(previous));
  }
  return Object.freeze({get,reset});
}
module.exports = {createRepositoryResource};
