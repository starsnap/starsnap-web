import React, { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImageIcon, CloseIcon, PlusIcon, CalendarIcon, LinkIcon, SearchIcon, CheckIcon } from '../../components/icons'
import Toggle from '../../components/ui/Toggle'
import {
    uploadPhoto,
    createSnap,
    searchStars,
    searchStarGroups,
    type StarSearchItem,
    type StarGroupSearchItem,
} from '../../services/snapService'
import { applyNextImageCandidate, getImageCandidates } from '../../utils/s3Image'

const fieldLabel = 'block text-sm font-bold text-ink mb-2'
const inputBase =
    'w-full h-11 rounded-lg border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand'

const MAX_PHOTOS = 10
const MAX_PHOTO_BYTES = 15 * 1024 * 1024
const SUPPORTED_PHOTO_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

type SelectedImage = { file: File; preview: string }

const todayString = () => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

const AddSnapPage: React.FC = () => {
    const navigate = useNavigate()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const dateInputRef = useRef<HTMLInputElement>(null)
    const submitInFlightRef = useRef(false)

    const [images, setImages] = useState<SelectedImage[]>([])
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [source, setSource] = useState('')
    const [dateTaken, setDateTaken] = useState(todayString())
    const [tags, setTags] = useState<string[]>([])
    const [tagInput, setTagInput] = useState('')
    const [starQuery, setStarQuery] = useState('')
    const [starGroupQuery, setStarGroupQuery] = useState('')
    const [starResults, setStarResults] = useState<StarSearchItem[]>([])
    const [starGroupResults, setStarGroupResults] = useState<StarGroupSearchItem[]>([])
    const [selectedStars, setSelectedStars] = useState<StarSearchItem[]>([])
    const [selectedStarGroups, setSelectedStarGroups] = useState<StarGroupSearchItem[]>([])
    const [starModalOpen, setStarModalOpen] = useState(false)
    const [starGroupModalOpen, setStarGroupModalOpen] = useState(false)
    const [modalSelectedStars, setModalSelectedStars] = useState<StarSearchItem[]>([])
    const [modalSelectedStarGroups, setModalSelectedStarGroups] = useState<StarGroupSearchItem[]>([])
    const [starLoading, setStarLoading] = useState(false)
    const [starGroupLoading, setStarGroupLoading] = useState(false)
    const [aiFlag, setAiFlag] = useState(false)
    const [commentState, setCommentState] = useState(true)

    const [dragOver, setDragOver] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState('')
    const [successMessage, setSuccessMessage] = useState('')

    const imagesRef = useRef(images)
    imagesRef.current = images
    useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.preview)), [])

    const addFiles = (fileList: FileList | null) => {
        if (!fileList) return
        const incoming = Array.from(fileList)
        const invalid = incoming.find((file) => {
            const contentType = file.type.split(';', 1)[0].trim().toLowerCase()
            return !SUPPORTED_PHOTO_TYPES.has(contentType) || file.size <= 0 || file.size > MAX_PHOTO_BYTES
        })
        if (invalid) {
            setErrorMessage('JPG, PNG, WebP 형식의 15 MiB 이하 사진만 업로드할 수 있습니다.')
            return
        }
        setErrorMessage('')
        setImages((prev) => {
            const room = MAX_PHOTOS - prev.length
            if (room <= 0) return prev
            const toAdd = incoming.slice(0, room).map((file) => ({ file, preview: URL.createObjectURL(file) }))
            return [...prev, ...toAdd]
        })
    }

    const removeImage = (index: number) => {
        setImages((prev) => {
            const target = prev[index]
            if (target) URL.revokeObjectURL(target.preview)
            return prev.filter((_, i) => i !== index)
        })
    }

    const openFilePicker = () => fileInputRef.current?.click()

    const addTag = () => {
        const value = tagInput.trim().replace(/^#/, '')
        if (!value) return
        if (!tags.includes(value)) setTags((prev) => [...prev, value])
        setTagInput('')
    }

    const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag))

    const isSameStar = (a: StarSearchItem, b: StarSearchItem) => {
        if (a.id && b.id) return a.id === b.id
        return a.name === b.name
    }

    const openStarModal = () => {
        setModalSelectedStars(selectedStars)
        setStarQuery('')
        setStarModalOpen(true)
    }

    const openStarGroupModal = () => {
        setModalSelectedStarGroups(selectedStarGroups)
        setStarGroupQuery('')
        setStarGroupModalOpen(true)
    }

    useEffect(() => {
        if (!starModalOpen) return
        let cancelled = false
        const timer = setTimeout(() => {
            setStarLoading(true)
            searchStars(starQuery.trim())
                .then((items) => {
                    if (cancelled) return
                    setStarResults(items)
                })
                .catch(() => {
                    if (cancelled) return
                    setStarResults([])
                })
                .finally(() => {
                    if (!cancelled) setStarLoading(false)
                })
        }, 200)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [starQuery, starModalOpen])

    useEffect(() => {
        if (!starGroupModalOpen) return
        let cancelled = false
        const timer = setTimeout(() => {
            setStarGroupLoading(true)
            searchStarGroups(starGroupQuery.trim())
                .then((items) => {
                    if (cancelled) return
                    setStarGroupResults(items)
                })
                .catch(() => {
                    if (cancelled) return
                    setStarGroupResults([])
                })
                .finally(() => {
                    if (!cancelled) setStarGroupLoading(false)
                })
        }, 200)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [starGroupQuery, starGroupModalOpen])

    const toggleStarInModal = (star: StarSearchItem) => {
        setModalSelectedStars((prev) => {
            const exists = prev.some((item) => isSameStar(item, star))
            if (exists) return prev.filter((item) => !isSameStar(item, star))
            return [...prev, star]
        })
    }

    const removeStar = (star: StarSearchItem) => {
        setSelectedStars((prev) =>
            prev.filter((item) => (item.id && star.id ? item.id !== star.id : item.name !== star.name)),
        )
    }

    const toggleStarGroupInModal = (group: StarGroupSearchItem) => {
        setModalSelectedStarGroups((prev) => {
            const exists = prev.some((item) => item.id === group.id)
            if (exists) return prev.filter((item) => item.id !== group.id)
            return [...prev, group]
        })
    }

    const removeStarGroup = (groupId: string) => {
        setSelectedStarGroups((prev) => prev.filter((item) => item.id !== groupId))
    }

    const openDatePicker = () => {
        const input = dateInputRef.current
        if (!input) return
        input.focus()
        if (typeof input.showPicker === 'function') {
            input.showPicker()
            return
        }
        input.click()
    }

    const handleSubmit = async () => {
        if (submitInFlightRef.current) return
        setErrorMessage('')
        setSuccessMessage('')

        if (images.length === 0) {
            setErrorMessage('이미지를 한 장 이상 추가해주세요.')
            return
        }
        if (title.trim() === '') {
            setErrorMessage('제목을 입력해주세요.')
            return
        }

        submitInFlightRef.current = true
        setSubmitting(true)
        try {
            const meta = { aiState: aiFlag, dateTaken, source }
            const photoKeys = await Promise.all(images.map((img) => uploadPhoto(img.file, meta)))

            await createSnap({
                title: title.trim(),
                description,
                source,
                tags,
                photos: photoKeys,
                starIds: selectedStars.map((star) => star.id).filter(Boolean),
                starGroupIds: selectedStarGroups.map((group) => group.id),
                commentState,
            })

            images.forEach((img) => URL.revokeObjectURL(img.preview))
            setImages([])
            setSuccessMessage('스냅이 업로드되었습니다.')
            navigate('/')
        } catch (err: any) {
            console.error('create snap failed')
            const msg =
                err?.response?.data?.message ||
                err?.response?.data ||
                err?.message ||
                '스냅 업로드 중 오류가 발생했습니다.'
            setErrorMessage(String(msg))
        } finally {
            submitInFlightRef.current = false
            setSubmitting(false)
        }
    }

    return (
        <div className="px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
            <h1 className="text-2xl font-bold text-ink mb-6">스냅 업로드</h1>

            <input
                ref={fileInputRef}
                id="snap-photo-input"
                name="snapPhotos"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                multiple
                className="absolute w-0 h-0 overflow-hidden opacity-0"
                onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                }}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-[1100px]">
                {/* Upload area */}
                <div>
                    <div
                        onDragOver={(e) => {
                            e.preventDefault()
                            setDragOver(true)
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                            e.preventDefault()
                            setDragOver(false)
                            addFiles(e.dataTransfer.files)
                        }}
                        className={`rounded-2xl border-2 border-dashed bg-panel flex flex-col items-center justify-center text-center py-20 px-6 transition-colors ${
                            dragOver ? 'border-brand bg-surface' : 'border-line'
                        }`}
                    >
                        <span className="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-5">
                            <ImageIcon size={28} className="text-muted" />
                        </span>
                        <p className="text-base font-bold text-ink">이미지를 끌어다 놓으세요</p>
                        <p className="mt-1.5 text-sm text-muted">
                            JPG, PNG, WebP · 장당 15 MiB · 최대 {MAX_PHOTOS}장
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                openFilePicker()
                            }}
                            className="mt-5 min-h-11 rounded-xl bg-brand px-5 text-sm font-bold text-on-brand hover:brightness-95"
                        >
                            파일 선택
                        </button>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                        {images.map((img, i) => (
                            <div
                                key={img.preview}
                                className="relative w-[88px] h-[88px] rounded-xl bg-placeholder overflow-hidden"
                            >
                                <img src={img.preview} alt="" width={88} height={88} className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => removeImage(i)}
                                    className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-full text-sub"
                                    aria-label={`선택한 이미지 ${i + 1} 제거`}
                                >
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-[var(--ss-surface-translucent)] text-ink shadow-sm">
                                        <CloseIcon size={14} />
                                    </span>
                                </button>
                            </div>
                        ))}
                        {images.length < MAX_PHOTOS && (
                            <button
                                type="button"
                                onClick={openFilePicker}
                                className="w-[88px] h-[88px] rounded-xl border-2 border-dashed border-line flex items-center justify-center text-muted hover:bg-surface"
                                aria-label="이미지 추가"
                            >
                                <PlusIcon size={22} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Form */}
                <div className="rounded-2xl border border-line bg-panel p-6">
                    <label className={fieldLabel} htmlFor="snap-title">제목</label>
                    <input
                        id="snap-title"
                        name="title"
                        autoComplete="off"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="스냅 제목을 입력하세요"
                        className={inputBase}
                    />

                    <div className="mt-5">
                        <label className={fieldLabel} htmlFor="snap-description">설명</label>
                        <textarea
                            id="snap-description"
                            name="description"
                            autoComplete="off"
                            rows={4}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="예: 오늘의 공연 순간을 기록해 보세요…"
                            className="w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-ink placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-brand"
                        />
                    </div>

                    <div className="mt-5">
                        <label className={fieldLabel} htmlFor="snap-tag">태그</label>
                        <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => (
                                <span
                                    key={tag}
                                    className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface pl-3 pr-1 text-sm text-sub"
                                >
                                    #{tag}
                                    <button
                                        type="button"
                                        onClick={() => removeTag(tag)}
                                        className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-ink"
                                        aria-label={`${tag} 태그 제거`}
                                    >
                                        <CloseIcon size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="mt-2 flex gap-2">
                            <input
                                id="snap-tag"
                                name="tag"
                                autoComplete="off"
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        addTag()
                                    }
                                }}
                                placeholder="예: 콘서트 입력 후 Enter…"
                                className={inputBase}
                            />
                            <button
                                type="button"
                                onClick={addTag}
                                className="h-11 px-4 shrink-0 inline-flex items-center gap-1 rounded-lg text-sm text-sub border border-dashed border-line hover:bg-surface"
                            >
                                <PlusIcon size={14} /> 추가
                            </button>
                        </div>
                    </div>

                    <div className="mt-5">
                        <label className={fieldLabel}>스타</label>
                        <div className="flex gap-3 overflow-x-auto pb-1">
                            <div className="shrink-0 w-[92px]">
                                <button
                                    type="button"
                                    onClick={openStarModal}
                                    className="relative mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full border border-line bg-surface text-sub hover:bg-placeholder"
                                >
                                    <PlusIcon size={18} />
                                </button>
                                <p className="mt-1.5 text-sm text-sub text-center">추가하기</p>
                            </div>

                            {selectedStars.map((star) => (
                                <div key={`${star.id || 'name'}-${star.name}`} className="shrink-0 w-[92px]">
                                    <div className="relative w-[72px] h-[72px] rounded-full bg-placeholder border border-line overflow-hidden mx-auto">
                                        {(() => {
                                            const imageCandidates = getImageCandidates(star.imageKey)
                                            return imageCandidates.length > 0 ? (
                                                <img
                                                    src={imageCandidates[0]}
                                                    alt={`${star.name} 프로필`}
                                                    width={72}
                                                    height={72}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => applyNextImageCandidate(e.currentTarget, imageCandidates)}
                                                />
                                            ) : null
                                        })()}
                                        <button
                                            type="button"
                                            onClick={() => removeStar(star)}
                                            className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center rounded-full text-sub"
                                            aria-label={`${star.name} 제거`}
                                        >
                                            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-[var(--ss-surface-translucent)] text-ink">
                                                <CloseIcon size={12} />
                                            </span>
                                        </button>
                                    </div>
                                    <p className="mt-1.5 text-sm text-sub text-center truncate">{star.name}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-5">
                        <label className={fieldLabel}>스타그룹</label>
                        <div className="flex gap-3 overflow-x-auto pb-1">
                            <div className="shrink-0 w-[112px]">
                                <button
                                    type="button"
                                    onClick={openStarGroupModal}
                                    className="relative mx-auto flex h-[60px] w-[100px] items-center justify-center rounded-xl border border-line bg-surface text-sub hover:bg-placeholder"
                                >
                                    <PlusIcon size={18} />
                                </button>
                                <p className="mt-1.5 text-sm text-sub text-center">추가하기</p>
                            </div>

                            {selectedStarGroups.map((group) => (
                                <div key={group.id} className="shrink-0 w-[112px]">
                                    <div className="relative w-[100px] h-[60px] rounded-xl bg-placeholder border border-line overflow-hidden mx-auto">
                                        {(() => {
                                            const imageCandidates = getImageCandidates(group.imageKey)
                                            return imageCandidates.length > 0 ? (
                                                <img
                                                    src={imageCandidates[0]}
                                                    alt={`${group.name} 썸네일`}
                                                    width={100}
                                                    height={60}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => applyNextImageCandidate(e.currentTarget, imageCandidates)}
                                                />
                                            ) : null
                                        })()}
                                        <button
                                            type="button"
                                            onClick={() => removeStarGroup(group.id)}
                                            className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center rounded-full text-sub"
                                            aria-label={`${group.name} 제거`}
                                        >
                                            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-[var(--ss-surface-translucent)] text-ink">
                                                <CloseIcon size={12} />
                                            </span>
                                        </button>
                                    </div>
                                    <p className="mt-1.5 text-sm text-sub text-center truncate">{group.name}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-4">
                        <div>
                            <label className={fieldLabel}>촬영 날짜</label>
                            <div className="relative select-none">
                                <input
                                    ref={dateInputRef}
                                    type="date"
                                    value={dateTaken}
                                    onChange={(e) => setDateTaken(e.target.value)}
                                    onClick={openDatePicker}
                                    className={`${inputBase} date-input-no-native-picker select-none pr-12 cursor-pointer`}
                                    style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                                />
                                <button
                                    type="button"
                                    onClick={openDatePicker}
                                    className="pointer-events-auto absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted"
                                    aria-label="촬영 날짜 달력 열기"
                                >
                                    <CalendarIcon size={18} className="pointer-events-none" />
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className={fieldLabel}>출처</label>
                            <div className="relative">
                                <input
                                    value={source}
                                    onChange={(e) => setSource(e.target.value)}
                                    className={inputBase}
                                    placeholder="Instagram @newjeans"
                                />
                                <LinkIcon
                                    size={18}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-ink">AI 생성 이미지 표시</p>
                            <p className="text-xs text-muted mt-0.5">AI로 만든 이미지인 경우 표시됩니다</p>
                        </div>
                        <Toggle ariaLabel="AI 생성 이미지 표시" checked={aiFlag} onChange={setAiFlag} />
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-ink">댓글 허용</p>
                            <p className="text-xs text-muted mt-0.5">다른 사용자가 댓글을 남길 수 있어요</p>
                        </div>
                        <Toggle ariaLabel="댓글 허용" checked={commentState} onChange={setCommentState} />
                    </div>

                    {errorMessage && <p className="mt-4 text-sm text-danger">{errorMessage}</p>}
                    {successMessage && <p className="mt-4 text-sm text-brand">{successMessage}</p>}

                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting || images.length === 0 || title.trim() === ''}
                        className="mt-6 w-full h-12 rounded-lg bg-brand text-on-brand font-bold hover:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {submitting ? '업로드 중...' : '게시하기'}
                    </button>
                </div>
            </div>

            {starModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
                    <div className="w-[760px] h-[640px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden rounded-3xl bg-panel border border-line flex flex-col">
                        <div className="h-14 px-6 flex items-center justify-between border-b border-line">
                            <h2 className="text-xl font-bold text-ink">스타 선택</h2>
                            <button
                                type="button"
                                onClick={() => setStarModalOpen(false)}
                                className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-muted"
                                aria-label="스타 선택 모달 닫기"
                            >
                                <CloseIcon size={16} />
                            </button>
                        </div>

                        <div className="flex-1 p-6 overflow-auto">
                            <div className="relative">
                                <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                                <input
                                    value={starQuery}
                                    onChange={(e) => setStarQuery(e.target.value)}
                                    placeholder="스타 또는 그룹 검색"
                                    className={`${inputBase} pl-9`}
                                />
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 min-h-8">
                                {modalSelectedStars.map((star) => (
                                    <button
                                        key={`chip-${star.id || star.name}`}
                                        type="button"
                                        onClick={() => toggleStarInModal(star)}
                                        className="min-h-11 rounded-full border border-brand bg-brand-soft px-3 text-sm text-sub"
                                    >
                                        {star.name} ×
                                    </button>
                                ))}
                            </div>

                            {starLoading ? (
                                <p className="mt-4 text-sm text-muted">검색 중...</p>
                            ) : (
                                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {starResults.map((star) => {
                                        const active = modalSelectedStars.some((item) => isSameStar(item, star))
                                        const imageCandidates = getImageCandidates(star.imageKey)
                                        return (
                                            <button
                                                key={`card-${star.id || star.name}`}
                                                type="button"
                                                onClick={() => toggleStarInModal(star)}
                                                className={`relative h-[150px] rounded-2xl border p-3 text-center ${
                                                    active ? 'border-brand ring-1 ring-brand' : 'border-line'
                                                }`}
                                            >
                                                {imageCandidates.length > 0 ? (
                                                    <img
                                                        src={imageCandidates[0]}
                                                        alt={`${star.name} 프로필`}
                                                        width={56}
                                                        height={56}
                                                        loading="lazy"
                                                        className="block w-14 h-14 rounded-full object-cover mx-auto"
                                                        onError={(e) => applyNextImageCandidate(e.currentTarget, imageCandidates)}
                                                    />
                                                ) : (
                                                    <span className="block w-14 h-14 rounded-full bg-placeholder mx-auto" />
                                                )}
                                                <p className="mt-3 text-base font-bold text-ink truncate">{star.name}</p>
                                                <p className="mt-0.5 text-xs text-muted truncate">{star.nickname || '-'}</p>
                                                {active && (
                                                    <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-on-brand">
                                                        <CheckIcon size={12} />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="h-16 px-6 border-t border-line flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setStarModalOpen(false)}
                                className="min-h-11 rounded-xl border border-line bg-panel px-6 font-bold text-ink"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedStars(modalSelectedStars)
                                    setStarModalOpen(false)
                                }}
                                className="min-h-11 rounded-xl bg-brand px-6 font-bold text-on-brand"
                            >
                                확인 ({modalSelectedStars.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {starGroupModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
                    <div className="w-[760px] h-[640px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden rounded-3xl bg-panel border border-line flex flex-col">
                        <div className="h-14 px-6 flex items-center justify-between border-b border-line">
                            <h2 className="text-xl font-bold text-ink">스타그룹 선택</h2>
                            <button
                                type="button"
                                onClick={() => setStarGroupModalOpen(false)}
                                className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-muted"
                                aria-label="스타그룹 선택 모달 닫기"
                            >
                                <CloseIcon size={16} />
                            </button>
                        </div>

                        <div className="flex-1 p-6 overflow-auto">
                            <div className="relative">
                                <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                                <input
                                    value={starGroupQuery}
                                    onChange={(e) => setStarGroupQuery(e.target.value)}
                                    placeholder="스타그룹 검색"
                                    className={`${inputBase} pl-9`}
                                />
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 min-h-8">
                                {modalSelectedStarGroups.map((group) => (
                                    <button
                                        key={`group-chip-${group.id}`}
                                        type="button"
                                        onClick={() => toggleStarGroupInModal(group)}
                                        className="min-h-11 rounded-full border border-brand bg-brand-soft px-3 text-sm text-sub"
                                    >
                                        {group.name} ×
                                    </button>
                                ))}
                            </div>

                            {starGroupLoading ? (
                                <p className="mt-4 text-sm text-muted">검색 중...</p>
                            ) : (
                                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {starGroupResults.map((group) => {
                                        const active = modalSelectedStarGroups.some((item) => item.id === group.id)
                                        const imageCandidates = getImageCandidates(group.imageKey)
                                        return (
                                            <button
                                                key={`group-card-${group.id}`}
                                                type="button"
                                                onClick={() => toggleStarGroupInModal(group)}
                                                className={`relative h-[120px] rounded-2xl border p-3 text-center ${
                                                    active ? 'border-brand ring-1 ring-brand' : 'border-line'
                                                }`}
                                            >
                                                {imageCandidates.length > 0 ? (
                                                    <img
                                                        src={imageCandidates[0]}
                                                        alt={`${group.name} 썸네일`}
                                                        width={56}
                                                        height={56}
                                                        loading="lazy"
                                                        className="block w-14 h-14 rounded-xl object-cover mx-auto"
                                                        onError={(e) => applyNextImageCandidate(e.currentTarget, imageCandidates)}
                                                    />
                                                ) : (
                                                    <span className="block w-14 h-14 rounded-xl bg-placeholder mx-auto" />
                                                )}
                                                <p className="mt-3 text-base font-bold text-ink truncate">{group.name}</p>
                                                {active && (
                                                    <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-on-brand">
                                                        <CheckIcon size={12} />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="h-16 px-6 border-t border-line flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setStarGroupModalOpen(false)}
                                className="min-h-11 rounded-xl border border-line bg-panel px-6 font-bold text-ink"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedStarGroups(modalSelectedStarGroups)
                                    setStarGroupModalOpen(false)
                                }}
                                className="min-h-11 rounded-xl bg-brand px-6 font-bold text-on-brand"
                            >
                                확인 ({modalSelectedStarGroups.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AddSnapPage
