export const PSEUDO_ANALYSIS_MAX_BYTES = 4 * 1024 * 1024;

async function withFiles(mode, action) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('apfs-pseudo-files', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('files', { keyPath: 'id' }).createIndex('scope', 'scope');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('files', mode);
      const request = action(transaction.objectStore('files'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('브라우저 자료 저장소를 사용할 수 없습니다.'));
    });
  } finally {
    db.close();
  }
}

function fileScope(session, companyId) {
  if (!session?.user?.id) throw new Error('다시 로그인해 주세요.');
  return session.user.id + '/' + companyId;
}

export async function listPseudoFiles(session, companyId) {
  const rows = await withFiles('readonly', store => store.index('scope').getAll(fileScope(session, companyId)));
  return rows.map(({ file, scope, ...metadata }) => metadata).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function savePseudoFile(session, companyId, category, file) {
  const row = { id: crypto.randomUUID(), scope: fileScope(session, companyId), name: file.name,
    size: file.size, category, created_at: new Date().toISOString(), pseudo: true, file };
  await withFiles('readwrite', store => store.add(row));
}

export async function readPseudoFile(session, companyId, id) {
  const row = await withFiles('readonly', store => store.get(id));
  if (!row?.file || row.scope !== fileScope(session, companyId)) throw new Error('자료를 다시 올려 주세요.');
  return row.file;
}

export async function removePseudoFile(session, companyId, id) {
  await readPseudoFile(session, companyId, id);
  await withFiles('readwrite', store => store.delete(id));
}
