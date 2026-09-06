import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, CheckIcon, CloseIcon, PlusIcon, SearchIcon } from '../../components/icons'
import Toggle from '../../components/ui/Toggle'
import type { SnapFeedItem, StarGroupSearchItem, StarSearchItem } from '../../services/snapService'
import { searchStarGroups, searchStars, updateSnap } from '../../services/snapService'
import { applyNextImageCandidate, getImageCandidates } from '../../utils/s3Image'

const fieldLabel = 'block text-sm font-bold text-ink mb-2'
const inputBase =
    'w-full h-11 rounded-lg border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand'

const encodeFileKey = (fileKey: string) =>
    fileKey
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/')

const buildS3Url = (baseUrl: string, fileKey: string) => `${baseUrl}/${encodeFileKey(fileKey)}`

const normalizeIdList = (value: unknown): string[] => {
    if (typeof value === 'string') return [value]
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === 'string')
}

const isSameStar = (a: StarSearchItem, b: StarSearchItem) => {
    if (a.id && b.id) return a.id === b.id
    return a.name === b.name
}

const EditSnapPage: React.FC = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const state = (location.state as { feedItem?: SnapFeedItem; canEdit?: boolean } | null) ?? null
    const feedItem = state?.feedItem

    const [title, setTitle] = useState(feedItem?.snapData.title ?? '')
    const [tags, setTags] = useState<string[]>(feedItem?.snapData.tags ?? [])
    const [tagInput, setTagInput] = useState('')
    const [commentState, setCommentState] = useState(!!feedItem?.snapData.commentState)
    const [submitting, setSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState('')
    const [starQuery, setStarQuery] = useState('')
    const [starGroupQuery, setStarGroupQuery] = useState('')
    const [starResults, setStarResults] = useState<StarSearchItem[]>([])
    const [starGroupResults, setStarGroupResults] = useState<StarGroupSearchItem[]>([])
    const [starModalOpen, setStarModalOpen] = useState(false)
    const [starGroupModalOpen, setStarGroupModalOpen] = useState(false)
    const [modalSelectedStars, setModalSelectedStars] = useState<StarSearchItem[]>([])
    const [modalSelectedStarGroups, setModalSelectedStarGroups] = useState<StarGroupSearchItem[]>([])
    const [starLoading, setStarLoading] = useState(false)
    const [starGroupLoading, setStarGroupLoading] = useState(false)

    const allStarsQuery = useMemo(() => {
        const snapRecord = (feedItem?.snapData ?? {}) as Record<string, unknown>
        const rootRecord = (feedItem ?? {}) as Record<string, unknown>

        const starIds = [
            ...normalizeIdList(snapRecord.starId),
            ...normalizeIdList(snapRecord.starIds),
            ...normalizeIdList(rootRecord.starId),
            ...normalizeIdList(rootRecord.starIds),
        ]

        return Array.from(new Set(starIds))
    }, [feedItem])

    const allStarGroupsQuery = useMemo(() => {
        const snapRecord = (feedItem?.snapData ?? {}) as Record<string, unknown>
        const rootRecord = (feedItem ?? {}) as Record<string, unknown>

        const starGroupIds = [
            ...normalizeIdList(snapRecord.starGroupId),
            ...normalizeIdList(snapRecord.starGroupIds),
            ...normalizeIdList(rootRecord.starGroupId),
            ...normalizeIdList(rootRecord.starGroupIds),
        ]

        return Array.from(new Set(starGroupIds))
    }, [feedItem])

    const previewPhoto = useMemo(() => feedItem?.snapData.photos?.[0], [feedItem])

    const [selectedStars, setSelectedStars] = useState<StarSearchItem[]>(() =>
        allStarsQuery.map((id, index) => ({ id, name: `연결된 스타 ${index + 1}` })),
    )
    const [selectedStarGroups, setSelectedStarGroups] = useState<StarGroupSearchItem[]>(() =>
        allStarGroupsQuery.map((id, index) => ({ id, name: `연결된 그룹 ${index + 1}` })),
    )

    const addTag = () => {
        const value = tagInput.trim().replace(/^#/, '')
        if (!value) return
        if (!tags.includes(value)) setTags((prev) => [...prev, value])
        setTagInput('')
    }

    const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag))

    useEffect(() => {
        setSelectedStars(allStarsQuery.map((id, index) => ({ id, name: `연결된 스타 ${index + 1}` })))
        if (allStarsQuery.length === 0) {
            return
        }

        let cancelled = false

        searchStars('', 0, 500)
            .then((items) => {
                if (cancelled) return
                const byId = new Map(items.map((item) => [item.id, item]))
                setSelectedStars((selected) => selected.map((item) => byId.get(item.id) ?? item))
            })
            .catch(() => {
                // Keep the original IDs when display information cannot be loaded.
            })

        return () => {
            cancelled = true
        }
    }, [allStarsQuery])

    useEffect(() => {
        setSelectedStarGroups(allStarGroupsQuery.map((id, index) => ({ id, name: `연결된 그룹 ${index + 1}` })))
        if (allStarGroupsQuery.length === 0) {
            return
        }

        let cancelled = false

        searchStarGroups('', 0, 500)
            .then((items) => {
                if (cancelled) return
                const byId = new Map(items.map((item) => [item.id, item]))
                setSelectedStarGroups((selected) => selected.map((item) => byId.get(item.id) ?? item))
            })
            .catch(() => {
                // Keep the original IDs when display information cannot be loaded.
            })

        return () => {
            cancelled = true
        }
    }, [allStarGroupsQuery])

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
                    if (!cancelled) setStarResults(items)
                })
                .catch(() => {
                    if (!cancelled) setStarResults([])
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
                    if (!cancelled) setStarGroupResults(items)
                })
                .catch(() => {
                    if (!cancelled) setStarGroupResults([])
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

    if (!feedItem || !state?.canEdit) {
        return (
            <div className="px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-1.5 text-sm text-sub hover:text-ink"
                >
                    <ChevronLeftIcon size={16} />
                    뒤로가기
                </button>
                <div className="mt-24 text-center">
                    <p className="text-sub text-sm">수정 가능한 스냅 정보가 없습니다.</p>
                </div>
            </div>
        )
    }

    const handleSubmit = async () => {
        setErrorMessage('')
        if (!title.trim()) {
            setErrorMessage('제목을 입력해주세요.')
            return
        }

        setSubmitting(true)
        try {
            const updatedSnap = await updateSnap({
                snapId: feedItem.snapData.snapId,
                title: title.trim(),
                tags,
                starIds: selectedStars.map((star) => star.id).filter(Boolean),
                starGroupIds: selectedStarGroups.map((group) => group.id),
                commentState,
            })

            navigate(`/snap/${feedItem.snapData.snapId}`, {
                replace: true,
                state: {
                    feedItem: updatedSnap,
                    canEdit: true,
                },
            })
        } catch (err: any) {
            const msg =
                err?.response?.data?.message ||
                err?.response?.data ||
                err?.message ||
                '스냅 수정 중 오류가 발생했습니다.'
            setErrorMessage(String(msg))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="max-w-[880px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
            <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-sm text-sub hover:text-ink"
            >
                <ChevronLeftIcon size={16} />
                뒤로가기
            </button>

            <h1 className="text-2xl font-bold text-ink mt-4">스냅 수정</h1>

            <div className="mt-6 rounded-2xl border border-line bg-panel p-6">
                {previewPhoto?.fileKey && (
                    <div className="mb-5 rounded-xl overflow-hidden bg-placeholder h-[240px]">
                        <img
                            src={buildS3Url(import.meta.env.VITE_S3_OUTPUT_BUCKET_URL, previewPhoto.fileKey)}
                            alt="스냅 미리보기"
                            width={1200}
                            height={600}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                const img = e.currentTarget
                                if (img.dataset.fallback !== 'input') {
                                    img.dataset.fallback = 'input'
                                    img.src = buildS3Url(import.meta.env.VITE_S3_INPUT_BUCKET_URL, previewPhoto.fileKey)
                                }
                            }}
                        />
                    </div>
                )}

                <label className={fieldLabel}>제목</label>
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="스냅 제목을 입력하세요"
                    className={inputBase}
                />

                <div className="mt-5">
                    <label className={fieldLabel}>태그</label>
                    <div className="flex flex-wrap gap-2">
                        {tags.map((tag) => (
                            <span
                                key={tag}
                                className="h-8 pl-3 pr-2 inline-flex items-center gap-1 rounded-full text-sm bg-surface text-sub border border-line"
                            >
                                #{tag}
                                <button
                                    type="button"
                                    onClick={() => removeTag(tag)}
                                    className="text-muted hover:text-ink"
                                >
                                    <CloseIcon size={12} />
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                        <input
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    addTag()
                                }
                            }}
                            placeholder="태그 입력 후 Enter"
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
                                        className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full bg-[var(--ss-surface-translucent)] border border-line flex items-center justify-center text-ink"
                                        aria-label={`${star.name} 제거`}
                                    >
                                        <CloseIcon size={12} />
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
                                        className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full bg-[var(--ss-surface-translucent)] border border-line flex items-center justify-center text-ink"
                                        aria-label={`${group.name} 제거`}
                                    >
                                        <CloseIcon size={12} />
                                    </button>
                                </div>
                                <p className="mt-1.5 text-sm text-sub text-center truncate">{group.name}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-5 flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-ink">댓글 허용</p>
                        <p className="text-xs text-muted mt-0.5">다른 사용자가 댓글을 남길 수 있어요</p>
                    </div>
                    <Toggle ariaLabel="댓글 허용" checked={commentState} onChange={setCommentState} />
                </div>

                {errorMessage && <p className="mt-4 text-sm text-danger">{errorMessage}</p>}

                <div className="mt-6 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="h-11 px-5 rounded-lg border border-line text-sm font-bold text-sub hover:text-ink"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={submitting}
                        className="h-11 px-5 rounded-lg bg-brand text-on-brand text-sm font-bold hover:brightness-95 disabled:opacity-60"
                    >
                        {submitting ? '저장 중...' : '수정 완료'}
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
                                className="w-8 h-8 rounded-md bg-surface text-muted flex items-center justify-center"
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
                                        className="h-7 rounded-full border border-brand bg-brand-soft px-3 text-sm text-sub"
                                    >
                                        {star.name} x
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
                                className="h-9 px-6 rounded-xl border border-line bg-panel text-ink font-bold"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedStars(modalSelectedStars)
                                    setStarModalOpen(false)
                                }}
                                className="h-9 rounded-xl bg-brand px-6 font-bold text-on-brand"
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
                                className="w-8 h-8 rounded-md bg-surface text-muted flex items-center justify-center"
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
                                        className="h-7 rounded-full border border-brand bg-brand-soft px-3 text-sm text-sub"
                                    >
                                        {group.name} x
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
                                className="h-9 px-6 rounded-xl border border-line bg-panel text-ink font-bold"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedStarGroups(modalSelectedStarGroups)
                                    setStarGroupModalOpen(false)
                                }}
                                className="h-9 rounded-xl bg-brand px-6 font-bold text-on-brand"
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

export default EditSnapPage
