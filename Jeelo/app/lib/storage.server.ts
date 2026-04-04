import { createServerClient } from "./supabase.server";

const BUCKET = "question-images";

/**
 * Uploads a File to Supabase Storage under {ownerId}/{uuid}.{ext}
 * Uses the service-role client so no RLS restrictions apply server-side.
 * Returns the public URL on success, or an error string.
 *
 * REQUIRES: a public bucket named "question-images" in Supabase Storage.
 * Create it in: Supabase Dashboard → Storage → New bucket → name it
 * "question-images" → tick "Public bucket".
 */
export async function uploadImage(
  file: File,
  ownerId: string,
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<{ publicUrl: string } | { error: string }> {
  const supabase = createServerClient(env);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;

  const bytes = await file.arrayBuffer();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (error) return { error: error.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl };
}

/**
 * Deletes an image from Supabase Storage given its full public URL.
 * Silently no-ops if the URL doesn't match the expected format.
 */
export async function deleteImage(
  publicUrl: string,
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<void> {
  const supabase = createServerClient(env);
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = publicUrl.slice(idx + marker.length);
  await supabase.storage.from(BUCKET).remove([path]);
}
