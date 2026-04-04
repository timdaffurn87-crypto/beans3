'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { useToast } from '@/components/ui/Toast'
import type { Recipe, Ingredient, InventoryItem } from '@/lib/types'

type Category = Recipe['category']

/** Add Recipe page — manager/owner only */
export default function AddRecipePage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('coffee')
  const [ingredients, setIngredients] = useState<Ingredient[]>([{ name: '', quantity: '', unit: '' }])

  // Inventory items for autocomplete suggestions on ingredient names
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])

  /** Load inventory items for ingredient name suggestions */
  useEffect(() => {
    async function loadInventory() {
      const supabase = createClient()
      const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('is_active', true)
        .order('name')
      setInventoryItems((data as InventoryItem[]) ?? [])
    }
    loadInventory()
  }, [])
  const [method, setMethod] = useState<string[]>([''])
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Auth guard — redirect baristas to home
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
    if (!loading && profile && (profile.role === 'barista' || profile.role === 'kitchen')) router.push('/')
  }, [profile, loading, router])

  /** Handle photo selected for upload */
  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  /** Remove the selected photo */
  function handleRemovePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  /** Add a blank ingredient row */
  function addIngredient() {
    setIngredients(prev => [...prev, { name: '', quantity: '', unit: '' }])
  }

  /** Update a field on an ingredient row by index.
   *  When the name matches an inventory item, auto-fill the unit of measure. */
  function updateIngredient(index: number, field: keyof Ingredient, value: string) {
    setIngredients(prev => prev.map((ing, i) => {
      if (i !== index) return ing
      const updated = { ...ing, [field]: value }

      // Auto-fill unit from inventory when the name matches
      if (field === 'name') {
        const match = inventoryItems.find(inv => inv.name.toLowerCase() === value.toLowerCase())
        if (match && match.unit_of_measure) {
          updated.unit = match.unit_of_measure
        }
      }

      return updated
    }))
  }

  /** Remove an ingredient row */
  function removeIngredient(index: number) {
    if (ingredients.length === 1) return // keep at least one row
    setIngredients(prev => prev.filter((_, i) => i !== index))
  }

  /** Add a blank method step */
  function addStep() {
    setMethod(prev => [...prev, ''])
  }

  /** Update a method step by index */
  function updateStep(index: number, value: string) {
    setMethod(prev => prev.map((s, i) => i === index ? value : s))
  }

  /** Remove a method step */
  function removeStep(index: number) {
    if (method.length === 1) return // keep at least one step
    setMethod(prev => prev.filter((_, i) => i !== index))
  }

  /** Upload the recipe photo to Supabase Storage and return the public URL */
  async function uploadPhoto(file: File): Promise<string> {
    const supabase = createClient()
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const { error } = await supabase.storage.from('recipe-photos').upload(filename, file)
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    const { data } = supabase.storage.from('recipe-photos').getPublicUrl(filename)
    return data.publicUrl
  }

  /** Submit the new recipe */
  async function handleSubmit() {
    if (!profile) return
    if (!name.trim()) {
      showToast('Recipe name is required', 'error')
      return
    }

    setSaving(true)
    const supabase = createClient()

    try {
      // Upload photo if one was selected
      let photoUrl: string | null = null
      if (photoFile) {
        photoUrl = await uploadPhoto(photoFile)
      }

      // Filter out empty ingredients and steps, link to inventory items where possible
      const cleanedIngredients = ingredients
        .filter(i => i.name.trim())
        .map(ing => {
          const match = inventoryItems.find(inv => inv.name.toLowerCase() === ing.name.toLowerCase())
          return { ...ing, inventory_item_id: match?.id ?? undefined }
        })
      const cleanedMethod = method.filter(s => s.trim())

      const { error } = await supabase.from('recipes').insert({
        name: name.trim(),
        category,
        ingredients: cleanedIngredients,
        method: cleanedMethod,
        notes: notes.trim() || null,
        photo_url: photoUrl,
        created_by: profile.id,
      })

      if (error) {
        showToast(error.message, 'error')
        setSaving(false)
        return
      }

      showToast('Recipe created', 'success')
      router.push('/recipes')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
      setSaving(false)
    }
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
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
        <h1 className="text-lg font-bold text-[#1A1A1A]">New Recipe</h1>
        {/* Placeholder to balance the header */}
        <div className="w-16" />
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
                alt="Recipe preview"
                className="w-full h-48 object-cover rounded-2xl"
              />
              <button
                onClick={handleRemovePhoto}
                className="absolute top-3 right-3 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full"
              >
                × Remove
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
            className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
          />
        </div>

        {/* Category */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as Category)}
            className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
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
              <div key={i} className="bg-white rounded-xl p-3 space-y-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    list="inventory-suggestions"
                    value={ing.name}
                    onChange={e => updateIngredient(i, 'name', e.target.value)}
                    placeholder="Ingredient name"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-[#FAF8F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                  />
                  {ingredients.length > 1 && (
                    <button
                      onClick={() => removeIngredient(i)}
                      className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-sm flex items-center justify-center shrink-0"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={ing.quantity}
                    onChange={e => updateIngredient(i, 'quantity', e.target.value)}
                    placeholder="Quantity (e.g. 22)"
                    className="px-3 py-2 rounded-lg border border-gray-200 bg-[#FAF8F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                  />
                  <input
                    type="text"
                    value={ing.unit}
                    onChange={e => updateIngredient(i, 'unit', e.target.value)}
                    placeholder="Unit (e.g. g, ml)"
                    className="px-3 py-2 rounded-lg border border-gray-200 bg-[#FAF8F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Datalist for inventory item name suggestions */}
          <datalist id="inventory-suggestions">
            {inventoryItems.map(inv => (
              <option key={inv.id} value={inv.name} />
            ))}
          </datalist>
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
              <div key={i} className="flex items-start gap-2 bg-white rounded-xl p-3 shadow-sm">
                <span className="text-[#B8960C] font-bold text-sm shrink-0 mt-2.5">{i + 1}.</span>
                <textarea
                  value={step}
                  onChange={e => updateStep(i, e.target.value)}
                  placeholder={`Step ${i + 1}`}
                  rows={2}
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-[#FAF8F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C] resize-none"
                />
                {method.length > 1 && (
                  <button
                    onClick={() => removeStep(i)}
                    className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-sm flex items-center justify-center shrink-0 mt-1"
                  >
                    ×
                  </button>
                )}
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
            className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C] resize-none"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2 pb-6">
          <button
            onClick={() => router.push('/recipes')}
            className="flex-1 py-3 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Create Recipe'}
          </button>
        </div>

      </div>
    </div>
  )
}
