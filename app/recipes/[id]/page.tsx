'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { useToast } from '@/components/ui/Toast'
import type { Recipe, Ingredient } from '@/lib/types'

type Category = Recipe['category']

/** Category badge styles */
const categoryBadge: Record<Category, string> = {
  coffee: 'bg-[#B8960C]/10 text-[#B8960C]',
  food: 'bg-green-50 text-green-700',
  beverage: 'bg-blue-50 text-blue-700',
}

/** Recipe Detail page — all roles view, manager/owner can edit/delete */
export default function RecipeDetailPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const { showToast } = useToast()
  const id = params.id as string

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loadingRecipe, setLoadingRecipe] = useState(true)
  const [showEditForm, setShowEditForm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Auth guard
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Fetch the recipe by ID */
  async function fetchRecipe() {
    const supabase = createClient()
    const { data } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', id)
      .single()

    setRecipe(data as Recipe | null)
    setLoadingRecipe(false)
  }

  useEffect(() => {
    if (profile && id) fetchRecipe()
  }, [profile, id])

  /** Delete the recipe and navigate back */
  async function handleDelete() {
    if (!recipe) return
    setDeleting(true)
    const supabase = createClient()
    const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)

    if (error) {
      showToast(error.message, 'error')
      setDeleting(false)
      return
    }

    showToast('Recipe deleted', 'success')
    router.push('/recipes')
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadingRecipe) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="min-h-screen pb-24 px-5 pt-12" style={{ backgroundColor: '#FAF8F3' }}>
        <button onClick={() => router.push('/recipes')} className="text-[#B8960C] text-sm mb-6">
          ← Recipes
        </button>
        <div className="bg-white rounded-2xl p-6 text-center">
          <p className="font-semibold text-[#1A1A1A]">Recipe not found</p>
          <p className="text-sm text-gray-400 mt-1">It may have been deleted.</p>
        </div>
      </div>
    )
  }

  const isManagerOrOwner = profile.role === 'manager' || profile.role === 'owner'

  // Show edit form overlay
  if (showEditForm) {
    return (
      <RecipeEditForm
        recipe={recipe}
        onSaved={(updated) => {
          setRecipe(updated)
          setShowEditForm(false)
          showToast('Recipe updated', 'success')
        }}
        onCancel={() => setShowEditForm(false)}
        onError={(msg) => showToast(msg, 'error')}
      />
    )
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-4 flex items-center justify-between">
        <button
          onClick={() => router.push('/recipes')}
          className="text-[#B8960C] text-sm flex items-center gap-1"
        >
          ← Recipes
        </button>
        {isManagerOrOwner && (
          <button
            onClick={() => setShowEditForm(true)}
            className="bg-[#B8960C] text-white text-sm font-semibold px-4 py-2 rounded-full"
          >
            Edit
          </button>
        )}
      </div>

      {/* Hero photo */}
      {recipe.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={recipe.photo_url}
          alt={recipe.name}
          className="w-full h-56 object-cover"
        />
      )}

      <div className="px-5 pt-4 space-y-6">
        {/* Title + category */}
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">{recipe.name}</h1>
          <span
            className={`inline-block mt-2 text-xs px-3 py-1 rounded-full font-medium ${categoryBadge[recipe.category]}`}
          >
            {recipe.category}
          </span>
        </div>

        {/* Ingredients */}
        {recipe.ingredients && recipe.ingredients.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">
              Ingredients
            </p>
            <div className="bg-white rounded-2xl p-4 space-y-2">
              {recipe.ingredients.map((ing, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[#B8960C] mt-0.5">•</span>
                  <span className="text-sm text-[#1A1A1A]">
                    <span className="font-medium">{ing.quantity} {ing.unit}</span>{' '}
                    {ing.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Method */}
        {recipe.method && recipe.method.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">
              Method
            </p>
            <div className="bg-white rounded-2xl p-4 space-y-3">
              {recipe.method.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-[#B8960C] font-bold text-sm shrink-0 mt-0.5">
                    {i + 1}.
                  </span>
                  <p className="text-sm text-[#1A1A1A] leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {recipe.notes && (
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">
              Notes
            </p>
            <div className="bg-white rounded-2xl p-4">
              <p className="text-sm text-gray-600 italic leading-relaxed">{recipe.notes}</p>
            </div>
          </div>
        )}

        {/* Delete section — manager/owner only */}
        {isManagerOrOwner && (
          <div className="pt-2">
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-3 rounded-full border border-red-200 text-[#DC2626] text-sm font-medium"
              >
                Delete Recipe
              </button>
            ) : (
              <div className="bg-white rounded-2xl p-4 space-y-3 border border-red-100">
                <p className="font-semibold text-[#1A1A1A] text-sm text-center">
                  Delete &ldquo;{recipe.name}&rdquo;?
                </p>
                <p className="text-xs text-gray-400 text-center">This cannot be undone.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-3 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 py-3 rounded-full bg-[#DC2626] text-white font-semibold text-sm disabled:opacity-40"
                  >
                    {deleting ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Inline edit form — shown as full-page overlay replacing the recipe view */
function RecipeEditForm({
  recipe,
  onSaved,
  onCancel,
  onError,
}: {
  recipe: Recipe
  onSaved: (updated: Recipe) => void
  onCancel: () => void
  onError: (msg: string) => void
}) {
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(recipe.name)
  const [category, setCategory] = useState<Category>(recipe.category)
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe.ingredients?.length > 0
      ? recipe.ingredients
      : [{ name: '', quantity: '', unit: '' }]
  )
  const [method, setMethod] = useState<string[]>(
    recipe.method?.length > 0 ? recipe.method : ['']
  )
  const [notes, setNotes] = useState(recipe.notes || '')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(recipe.photo_url || null)
  const [saving, setSaving] = useState(false)

  /** Handle new photo selected for upload */
  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  /** Add a blank ingredient row */
  function addIngredient() {
    setIngredients(prev => [...prev, { name: '', quantity: '', unit: '' }])
  }

  /** Update a field on an ingredient row */
  function updateIngredient(index: number, field: keyof Ingredient, value: string) {
    setIngredients(prev => prev.map((ing, i) => i === index ? { ...ing, [field]: value } : ing))
  }

  /** Remove an ingredient row */
  function removeIngredient(index: number) {
    setIngredients(prev => prev.filter((_, i) => i !== index))
  }

  /** Add a blank method step */
  function addStep() {
    setMethod(prev => [...prev, ''])
  }

  /** Update a method step */
  function updateStep(index: number, value: string) {
    setMethod(prev => prev.map((s, i) => i === index ? value : s))
  }

  /** Remove a method step */
  function removeStep(index: number) {
    setMethod(prev => prev.filter((_, i) => i !== index))
  }

  /** Upload a new recipe photo to storage and return public URL */
  async function uploadPhoto(file: File): Promise<string> {
    const supabase = createClient()
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const { error } = await supabase.storage.from('recipe-photos').upload(filename, file)
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    const { data } = supabase.storage.from('recipe-photos').getPublicUrl(filename)
    return data.publicUrl
  }

  async function handleSave() {
    if (!name.trim()) { onError('Recipe name is required'); return }

    setSaving(true)
    const supabase = createClient()

    try {
      // Upload new photo if one was selected
      let photoUrl = recipe.photo_url
      if (photoFile) {
        photoUrl = await uploadPhoto(photoFile)
      }

      // Filter out empty ingredients and steps
      const cleanedIngredients = ingredients.filter(i => i.name.trim())
      const cleanedMethod = method.filter(s => s.trim())

      const { data, error } = await supabase
        .from('recipes')
        .update({
          name: name.trim(),
          category,
          ingredients: cleanedIngredients,
          method: cleanedMethod,
          notes: notes.trim() || null,
          photo_url: photoUrl,
        })
        .eq('id', recipe.id)
        .select()
        .single()

      if (error) {
        onError(error.message)
        setSaving(false)
        return
      }

      onSaved(data as Recipe)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen pb-24 overflow-y-auto" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-4 flex items-center justify-between">
        <button onClick={onCancel} className="text-gray-400 text-sm font-medium">
          Cancel
        </button>
        <h1 className="text-lg font-bold text-[#1A1A1A]">Edit Recipe</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#B8960C] text-white text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="px-5 space-y-5">

        {/* Photo upload */}
        <div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoSelect}
          />
          {photoPreview ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt="Recipe"
                className="w-full h-48 object-cover rounded-2xl"
              />
              <button
                onClick={() => photoInputRef.current?.click()}
                className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full"
              >
                Change Photo
              </button>
            </div>
          ) : (
            <button
              onClick={() => photoInputRef.current?.click()}
              className="w-full h-32 border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors"
            >
              <span className="text-2xl">📷</span>
              <span className="text-sm font-medium">Add photo (optional)</span>
            </button>
          )}
        </div>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Recipe Name <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Signature Latte"
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          />
        </div>

        {/* Category */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as Category)}
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          >
            <option value="coffee">Coffee</option>
            <option value="food">Food</option>
            <option value="beverage">Beverage</option>
          </select>
        </div>

        {/* Ingredients */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400">Ingredients</p>
            <button
              onClick={addIngredient}
              className="w-7 h-7 rounded-full bg-[#B8960C] text-white text-lg flex items-center justify-center leading-none"
            >
              +
            </button>
          </div>
          <div className="space-y-2">
            {ingredients.map((ing, i) => (
              <div key={i} className="bg-white rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={ing.name}
                    onChange={e => updateIngredient(i, 'name', e.target.value)}
                    placeholder="Ingredient name"
                    className="flex-1 px-3 py-2 rounded-lg bg-[#f1ede7] border-0 border-b-2 border-transparent text-sm focus:outline-none focus:border-[#296861]"
                  />
                  <button
                    onClick={() => removeIngredient(i)}
                    className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-sm flex items-center justify-center shrink-0"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={ing.quantity}
                    onChange={e => updateIngredient(i, 'quantity', e.target.value)}
                    placeholder="Quantity (e.g. 22)"
                    className="px-3 py-2 rounded-lg bg-[#f1ede7] border-0 border-b-2 border-transparent text-sm focus:outline-none focus:border-[#296861]"
                  />
                  <input
                    type="text"
                    value={ing.unit}
                    onChange={e => updateIngredient(i, 'unit', e.target.value)}
                    placeholder="Unit (e.g. g, ml)"
                    className="px-3 py-2 rounded-lg bg-[#f1ede7] border-0 border-b-2 border-transparent text-sm focus:outline-none focus:border-[#296861]"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Method */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400">Method</p>
            <button
              onClick={addStep}
              className="w-7 h-7 rounded-full bg-[#B8960C] text-white text-lg flex items-center justify-center leading-none"
            >
              +
            </button>
          </div>
          <div className="space-y-2">
            {method.map((step, i) => (
              <div key={i} className="flex items-start gap-2 bg-white rounded-xl p-3">
                <span className="text-[#B8960C] font-bold text-sm shrink-0 mt-2.5">{i + 1}.</span>
                <textarea
                  value={step}
                  onChange={e => updateStep(i, e.target.value)}
                  placeholder={`Step ${i + 1}`}
                  rows={2}
                  className="flex-1 px-3 py-2 rounded-lg bg-[#f1ede7] border-0 border-b-2 border-transparent text-sm focus:outline-none focus:border-[#296861] resize-none"
                />
                <button
                  onClick={() => removeStep(i)}
                  className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-sm flex items-center justify-center shrink-0 mt-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Notes <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Use oat milk for oat latte variant"
            rows={3}
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-sm focus:outline-none focus:border-[#296861] resize-none"
          />
        </div>

      </div>
    </div>
  )
}
