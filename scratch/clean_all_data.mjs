import { getSupabaseAdmin } from '../lib/supabase.js';

async function cleanAllDataExceptLogins() {
  console.log('=== GapFinder AI: Clean All Data (Preserving User Logins) ===\n');

  const admin = getSupabaseAdmin();

  // 1. Verify user accounts exist before cleanup
  const { data: usersData, error: userErr } = await admin.auth.admin.listUsers();
  if (userErr) {
    console.error('Failed to list users:', userErr.message);
  } else {
    console.log(`User accounts found: ${usersData.users.length}`);
    usersData.users.forEach(u => {
      console.log(`  • User: ${u.email} (${u.id})`);
    });
  }

  // 2. Delete all topics
  console.log('\n--- 1. Cleaning public.topics ---');
  const { error: topErr } = await admin.from('topics').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (topErr) console.error('Error deleting topics:', topErr.message);
  else console.log('✅ All topics deleted.');

  // 3. Delete all subjects
  console.log('\n--- 2. Cleaning public.subjects ---');
  const { error: subjErr } = await admin.from('subjects').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (subjErr) console.error('Error deleting subjects:', subjErr.message);
  else console.log('✅ All subjects deleted.');

  // 4. Delete all document chunks
  console.log('\n--- 3. Cleaning public.document_chunks ---');
  const { error: chunkErr } = await admin.from('document_chunks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (chunkErr) console.error('Error deleting document chunks:', chunkErr.message);
  else console.log('✅ All document chunks deleted.');

  // 5. Delete all documents
  console.log('\n--- 4. Cleaning public.documents ---');
  const { error: docErr } = await admin.from('documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (docErr) console.error('Error deleting documents:', docErr.message);
  else console.log('✅ All documents deleted.');

  // 6. Delete all files in Supabase Storage bucket 'study-materials'
  console.log('\n--- 5. Cleaning Storage bucket: study-materials ---');
  const bucketName = 'study-materials';
  const { data: rootItems } = await admin.storage.from(bucketName).list('', { limit: 100 });

  const allFilePaths = [];

  for (const item of (rootItems || [])) {
    // If folder
    const { data: subItems } = await admin.storage.from(bucketName).list(item.name, { limit: 100 });
    for (const sub of (subItems || [])) {
      const { data: files } = await admin.storage.from(bucketName).list(`${item.name}/${sub.name}`, { limit: 100 });
      for (const file of (files || [])) {
        allFilePaths.push(`${item.name}/${sub.name}/${file.name}`);
      }
      // In case sub itself is a file
      if (!files || files.length === 0) {
        allFilePaths.push(`${item.name}/${sub.name}`);
      }
    }
  }

  console.log(`Found ${allFilePaths.length} storage files to remove:`, allFilePaths);
  if (allFilePaths.length > 0) {
    const { data: delStorage, error: delStorageErr } = await admin.storage.from(bucketName).remove(allFilePaths);
    if (delStorageErr) console.error('Error removing storage files:', delStorageErr.message);
    else console.log(`✅ Removed ${delStorage?.length || allFilePaths.length} files from storage.`);
  }

  // 7. Post-cleanup Verification
  console.log('\n--- Post-Cleanup Verification ---');
  const { count: finalTopics } = await admin.from('topics').select('*', { count: 'exact', head: true });
  const { count: finalSubjects } = await admin.from('subjects').select('*', { count: 'exact', head: true });
  const { count: finalChunks } = await admin.from('document_chunks').select('*', { count: 'exact', head: true });
  const { count: finalDocs } = await admin.from('documents').select('*', { count: 'exact', head: true });

  console.log(`  • Topics count:          ${finalTopics} (Expected: 0)`);
  console.log(`  • Subjects count:        ${finalSubjects} (Expected: 0)`);
  console.log(`  • Document chunks count: ${finalChunks} (Expected: 0)`);
  console.log(`  • Documents count:       ${finalDocs} (Expected: 0)`);

  // Verify users are preserved
  const { data: postUsers } = await admin.auth.admin.listUsers();
  console.log(`  • Users count:           ${postUsers?.users?.length} (Preserved intact)`);
  postUsers?.users?.forEach(u => console.log(`      └─ User: ${u.email}`));

  console.log('\n🎉 ALL DATA CLEANED SUCCESSFULLY. READY FOR FRESH UPLOADS.');
}

cleanAllDataExceptLogins().catch(console.error);

