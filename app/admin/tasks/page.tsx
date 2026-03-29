'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { TaskTemplate } from '@/lib/types'

type Station = 'brew_bar' | 'kitchen' | 'front_counter' | 'cleaning'

/** Maps station keys to human-readable display names */
const STATION_LABELS: Record<Station, string> = {
  brew_bar: 'Brew Bar',
  kitchen: 'Kitchen',
  front_counter: 'Front Counter',
  cleaning: 'Cleaning',
}

const STATION_OPTIONS: Station[] = ['brew_bar', 'kitchen', 'front_counter', 'cleaning']

/** Task Templates admin page — manager/owner only */
export default function TaskTemplatesPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Auth guard — baristas cannot access this page
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
    if (!loading && profile && profile.role === 'barista') router.push('/')
  }, [profile, loading, router])

  /** Fetch all active task templates ordered by station then sort_order */
  async function fetchTemplates() {
    const supabase = createClient()
    const { data } = await supabase
      .from('task_templates')
      .select('*')
      .eq('is_active', true)
      .order('station')
      .order('sort_order')
    setTemplates((data as TaskTemplate[]) ?? [])
    setLoadingTemplates(false)
  }

  useEffect(() => {
    if (profile) fetchTemplates()
  }, [profile])

  /** Soft-delete a template by marking is_active = false */
  async function handleDelete(id: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('task_templates')
      .update({ is_active: false })
      .eq('id', id)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    setConfirmDeleteId(null)
    fetchTemplates()
    showToast('Template deleted', 'success')
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Group visible templates by station
  const stations = Array.from(new Set(templates.map(t => t.station))) as Station[]

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Task Templates</h1>
        <p className="text-sm text-gray-400 mt-1">Manage recurring daily tasks</p>
      </div>

      <div className="px-5 space-y-4">
        {/* Section label + add button */}
        <div className="flex items-center justify-between">
          <p className="section-label">Templates ({templates.length})</p>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="text-sm font-semibold text-[#B8960C]"
          >
            {showAddForm ? 'Cancel' : '+ Add Template'}
          </button>
        </div>

        {/* Add template form */}
        {showAddForm && (
          <AddTemplateForm
            profileId={profile.id}
            onSuccess={() => {
              setShowAddForm(false)
              fetchTemplates()
              showToast('Template added', 'success')
            }}
            onError={(msg) => showToast(msg, 'error')}
          />
        )}

        {/* Templates grouped by station */}
        {loadingTemplates ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-400 text-sm">No templates yet. Add one above.</p>
          </div>
        ) : (
          stations.map(station => (
            <div key={station}>
              <p className="section-label mb-2">{STATION_LABELS[station] ?? station}</p>
              <div className="space-y-2">
                {templates
                  .filter(t => t.station === station)
                  .map(template => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      isEditing={editingId === template.id}
                      onEdit={() => setEditingId(template.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onUpdated={() => {
                        setEditingId(null)
                        fetchTemplates()
                        showToast('Template updated', 'success')
                      }}
                      onError={(msg) => showToast(msg, 'error')}
                      onDeleteRequest={() => setConfirmDeleteId(template.id)}
                    />
                  ))}
              </div>
            </div>
          ))
        )}

        {/* Note about template changes */}
        <div className="bg-[#B8960C]/8 rounded-2xl p-4">
          <p className="text-xs text-[#B8960C] font-medium">
            Changes take effect from tomorrow's café day. Today's existing tasks are not affected.
          </p>
        </div>
      </div>

      {/* Delete confirmation overlay */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end justify-center px-5 pb-8">
          <div className="bg-white rounded-2xl p-5 w-full max-w-[390px] shadow-xl space-y-4">
            <h3 className="font-semibold text-[#1A1A1A]">Delete this template?</h3>
            <p className="text-sm text-gray-500">
              It won't affect today's tasks. Future café days won't include this task.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-3 rounded-full border border-gray-200 text-gray-600 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 py-3 rounded-full bg-[#DC2626] text-white font-semibold text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Form to create a new task template */
function AddTemplateForm({
  profileId,
  onSuccess,
  onError,
}: {
  profileId: string
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [station, setStation] = useState<Station>('brew_bar')
  const [sortOrder, setSortOrder] = useState('0')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!title.trim()) { onError('Title is required'); return }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from('task_templates').insert({
      title: title.trim(),
      description: description.trim() || null,
      station,
      sort_order: parseInt(sortOrder, 10) || 0,
      created_by: profileId,
      is_active: true,
    })
    setLoading(false)

    if (error) { onError(error.message); return }
    await logActivity(profileId, 'task_template_created', `Created task template: ${title.trim()}`)
    onSuccess()
  }

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3">
      <h3 className="font-semibold text-[#1A1A1A]">New Template</h3>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Title</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Clean steam wand"
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Description <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Additional details or instructions"
          rows={2}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861] resize-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Station</label>
        <select
          value={station}
          onChange={e => setStation(e.target.value as Station)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        >
          {STATION_OPTIONS.map(s => (
            <option key={s} value={s}>{STATION_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Sort Order</label>
        <input
          type="number"
          step="1"
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
          placeholder="0"
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
      >
        {loading ? 'Adding…' : 'Add Template'}
      </button>
    </div>
  )
}

/** Single template card with inline edit capability */
function TemplateCard({
  template,
  isEditing,
  onEdit,
  onCancelEdit,
  onUpdated,
  onError,
  onDeleteRequest,
}: {
  template: TaskTemplate
  isEditing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onUpdated: () => void
  onError: (msg: string) => void
  onDeleteRequest: () => void
}) {
  const [title, setTitle] = useState(template.title)
  const [description, setDescription] = useState(template.description ?? '')
  const [station, setStation] = useState<Station>(template.station as Station)
  const [sortOrder, setSortOrder] = useState(template.sort_order.toString())
  const [loading, setLoading] = useState(false)

  async function handleUpdate() {
    if (!title.trim()) { onError('Title is required'); return }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('task_templates')
      .update({
        title: title.trim(),
        description: description.trim() || null,
        station,
        sort_order: parseInt(sortOrder, 10) || 0,
      })
      .eq('id', template.id)
    setLoading(false)

    if (error) { onError(error.message); return }
    onUpdated()
  }

  if (!isEditing) {
    return (
      <div className="bg-white rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#1A1A1A] text-sm">{template.title}</p>
            {template.description && (
              <p className="text-xs text-gray-400 mt-0.5">{template.description}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">Sort order: {template.sort_order}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={onEdit} className="text-[#B8960C] text-sm font-medium">
              Edit
            </button>
            <button onClick={onDeleteRequest} className="text-[#DC2626] text-sm font-medium">
              Delete
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3 border-2 border-[#B8960C]/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#1A1A1A]">Edit Template</h3>
        <button onClick={onCancelEdit} className="text-gray-400 text-sm">Cancel</button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Title</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Description <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={2}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861] resize-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Station</label>
        <select
          value={station}
          onChange={e => setStation(e.target.value as Station)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        >
          {STATION_OPTIONS.map(s => (
            <option key={s} value={s}>{STATION_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Sort Order</label>
        <input
          type="number"
          step="1"
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      <button
        onClick={handleUpdate}
        disabled={loading}
        className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
      >
        {loading ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )
}
