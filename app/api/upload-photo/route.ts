/**
 * app/api/upload-photo/route.ts
 *
 * POST endpoint that accepts a file upload and stores it in Supabase Storage
 * using the service role key. This bypasses storage RLS, which is correct here
 * because we authenticate the caller via their Supabase session cookie before
 * accepting any upload.
 *
 * Body: multipart/form-data with:
 *   - file: the File to upload
 *   - bucket: storage bucket name (e.g. "invoice-photos")
 *   - path: destination path within the bucket (e.g. "2026-03-30/filename.jpg")
 *
 * Returns: { url: string } — the public URL of the uploaded file
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  const cookieStore = await cookies()

  // Authenticate the caller via their session cookie
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse the multipart form data
  const formData = await request.formData()
  const file   = formData.get('file') as File | null
  const bucket = formData.get('bucket') as string | null
  const path   = formData.get('path') as string | null

  if (!file || !bucket || !path) {
    return NextResponse.json({ error: 'Missing file, bucket, or path' }, { status: 400 })
  }

  // Use service role to bypass storage RLS
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const arrayBuffer = await file.arrayBuffer()
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data } = admin.storage.from(bucket).getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl })
}
