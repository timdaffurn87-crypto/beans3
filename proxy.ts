import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Middleware: protects routes from unauthenticated access and enforces role-based access control.
 * - /login is always accessible
 * - All other routes require authentication
 * - /admin/settings requires owner role
 * - /results requires manager or owner role
 * - /admin/menu and /admin/tasks require manager or owner role
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (pathname === '/login' || pathname.startsWith('/_next') || pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  // Create Supabase client with request/response cookies
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Redirect to login if not authenticated
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Role-based access control for admin routes
  if (
    pathname.startsWith('/admin/settings') ||
    pathname.startsWith('/results') ||
    pathname.startsWith('/admin/menu') ||
    pathname.startsWith('/admin/tasks')
  ) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role

    // Settings requires owner
    if (pathname.startsWith('/admin/settings') && role !== 'owner') {
      return NextResponse.redirect(new URL('/', request.url))
    }

    // Results, menu, admin tasks require manager or owner
    if (
      (pathname.startsWith('/results') ||
        pathname.startsWith('/admin/menu') ||
        pathname.startsWith('/admin/tasks')) &&
      role !== 'manager' &&
      role !== 'owner'
    ) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)'],
}
