'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import type { Recipe } from '@/lib/types'

type CategoryFilter = 'all' | 'coffee' | 'food' | 'beverage'

/** Category badge styles — consistent with the rest of the app */
const categoryBadge: Record<Recipe['category'], string> = {
  coffee: 'bg-[#B8960C]/10 text-[#B8960C]',
  food: 'bg-green-50 text-green-700',
  beverage: 'bg-blue-50 text-blue-700',
}

/** Returns initials (up to 2 chars) for the placeholder avatar */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Recipe Book page — all roles can view, manager/owner can add */
export default function RecipesPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()

  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loadingRecipes, setLoadingRecipes] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all')

  // Auth guard
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Fetch all recipes ordered by name */
  async function fetchRecipes() {
    const supabase = createClient()
    const { data } = await supabase
      .from('recipes')
      .select('*')
      .order('name')
    setRecipes((data as Recipe[]) ?? [])
    setLoadingRecipes(false)
  }

  useEffect(() => {
    if (profile) fetchRecipes()
  }, [profile])

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isManagerOrOwner = profile.role === 'manager' || profile.role === 'owner'

  // Client-side filter by search and category
  const filtered = recipes.filter(recipe => {
    const matchesSearch = recipe.name.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || recipe.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const categoryFilters: { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'coffee', label: 'Coffee' },
    { value: 'food', label: 'Food' },
    { value: 'beverage', label: 'Beverage' },
  ]

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-4">
        <button
          onClick={() => router.back()}
          className="text-[#B8960C] text-sm mb-3 flex items-center gap-1"
        >
          ← Back
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">Recipe Book</h1>
            <p className="text-sm text-gray-400 mt-1">Browse café recipes</p>
          </div>
          {/* Add Recipe button — manager/owner only */}
          {isManagerOrOwner && (
            <button
              onClick={() => router.push('/recipes/add')}
              className="bg-[#B8960C] text-white text-sm font-semibold px-4 py-2 rounded-full"
            >
              + Add Recipe
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="px-5 mb-3">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="w-full pl-9 pr-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-sm focus:outline-none focus:border-[#296861]"
          />
        </div>
      </div>

      {/* Category filter pills — horizontal scroll */}
      <div className="px-5 mb-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {categoryFilters.map(filter => (
            <button
              key={filter.value}
              onClick={() => setSelectedCategory(filter.value)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === filter.value
                  ? 'bg-[#B8960C] text-white'
                  : 'bg-white text-gray-500 border border-gray-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Recipe list */}
      <div className="px-5">
        {loadingRecipes ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            {recipes.length === 0 ? (
              <>
                <p className="text-2xl mb-2">📖</p>
                <p className="font-semibold text-[#1A1A1A]">No recipes yet</p>
                {isManagerOrOwner && (
                  <p className="text-sm text-gray-400 mt-1">
                    Tap &ldquo;+ Add Recipe&rdquo; to create your first recipe.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="font-semibold text-[#1A1A1A]">No recipes match your search</p>
                <p className="text-sm text-gray-400 mt-1">Try a different name or category.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(recipe => (
              <button
                key={recipe.id}
                onClick={() => router.push(`/recipes/${recipe.id}`)}
                className="w-full bg-white rounded-2xl overflow-hidden flex items-center gap-4 p-3 text-left active:scale-[0.99] transition-transform"
              >
                {/* Photo or placeholder initials */}
                {recipe.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={recipe.photo_url}
                    alt={recipe.name}
                    className="w-16 h-16 object-cover rounded-xl shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-[#B8960C]/10 flex items-center justify-center shrink-0">
                    <span className="text-[#B8960C] font-bold text-lg">
                      {getInitials(recipe.name)}
                    </span>
                  </div>
                )}

                {/* Recipe info */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#1A1A1A] truncate">{recipe.name}</p>
                  <span
                    className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${categoryBadge[recipe.category]}`}
                  >
                    {recipe.category}
                  </span>
                  {recipe.ingredients && recipe.ingredients.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>

                {/* Chevron */}
                <svg
                  className="w-4 h-4 text-gray-300 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
