import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import CustomAxios from '../../lib/axios/CustomAxios';
import { getSocialAppUrl } from '../../lib/appSurface';
import { queryClient } from '../../lib/query/queryClient';
import token from '../../lib/token/token';

type LoginPageProps = {
    surface?: 'social' | 'chat' | 'bible';
};

type LoginLocationState = {
    from?: unknown;
};

const resolvePostLoginPath = (state: LoginLocationState | null): string => {
    const path = state?.from;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return '/';
    return path;
};

const LoginPage: React.FC<LoginPageProps> = ({ surface = 'social' }) => {
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const location = useLocation();
    const navigate = useNavigate();
    const isChatSurface = surface === 'chat';
    const isBibleSurface = surface === 'bible';
    const loginSubtitle = isChatSurface
        ? 'SNS에서 이어진 대화를 메시지 전용 화면에서 만나보세요'
        : isBibleSurface
            ? '성경 말씀을 찾고, 한 절 또는 여러 절로 QT를 기록해보세요'
            : '좋아하는 스타의 순간을 한곳에 모아보세요';

    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const isEnabled = identifier.trim() !== '' && password.trim() !== '' && !loading;

    useEffect(() => {
        if (!isChatSurface) return;

        const previousTitle = document.title;
        document.title = 'StarSnap Chat 로그인';
        return () => {
            document.title = previousTitle;
        };
    }, [isChatSurface]);

    const handleLogin = async () => {
        if (!isEnabled) return;
        setErrorMessage('');
        setLoading(true);
        try {
            const loginType = identifier.includes('@') ? 'EMAIL' : 'USERNAME';
            const resp = await CustomAxios.post(
                isBibleSurface ? 'bible/auth/login' : 'auth/login',
                isBibleSurface
                    ? { username: identifier, password }
                    : { username: identifier, password, loginType },
            );

            if (resp.status === 200 && resp.data) {
                queryClient.clear();
                token.markAuthenticated();
                navigate(resolvePostLoginPath(location.state as LoginLocationState | null), { replace: true });
            } else {
                setErrorMessage('로그인에 실패했습니다. 다시 시도해주세요.');
            }
        } catch (err: any) {
            const status = err?.response?.status;
            if (status === 429) {
                setErrorMessage('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
            } else if (typeof status === 'number' && status >= 400 && status < 500) {
                setErrorMessage('아이디 또는 비밀번호를 확인해주세요.');
            } else {
                setErrorMessage('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        void handleLogin();
    };

    const inputClass =
        'w-full h-12 rounded-xl border border-line bg-panel px-4 text-sm text-ink placeholder:text-muted hover:border-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

    return (
        <div
            className={`relative flex items-center justify-center px-4 ${
                isChatSurface ? 'min-h-[100svh] py-4 sm:py-10' : 'min-h-screen overflow-hidden py-10'
            }`}
            style={{
                background: 'radial-gradient(circle at 18% 14%, var(--ss-brand-soft) 0, transparent 30%), radial-gradient(circle at 86% 86%, var(--ss-border) 0, transparent 34%), var(--ss-canvas)',
            }}
        >
            <div className="w-full max-w-[400px] bg-panel rounded-[24px] border border-line shadow-[var(--ss-shadow-md)] px-6 py-8 sm:px-9 sm:py-10">
                <div className="text-center">
                    <h1 className="flex items-center justify-center gap-2.5 text-2xl font-extrabold tracking-tight text-ink">
                        <img
                            src="/icon-96.png"
                            alt=""
                            aria-hidden="true"
                            width={96}
                            height={96}
                            className="h-10 w-10 shrink-0 rounded-xl object-cover"
                        />
                        {isChatSurface ? 'StarSnap Chat' : 'StarSnap'}
                    </h1>
                    <p className="mt-2 text-sm text-sub">
                        {loginSubtitle}
                    </p>
                </div>

                <form className="mt-7 flex flex-col gap-4" onSubmit={handleSubmit}>
                    <div>
                        <label htmlFor="login-identifier" className="block text-sm font-bold text-ink mb-1.5">
                            {isBibleSurface ? '아이디' : '아이디 또는 이메일'}
                        </label>
                        <input
                            id="login-identifier"
                            className={inputClass}
                            name="identifier"
                            type="text"
                            placeholder={isBibleSurface ? '아이디를 입력하세요…' : '예: 아이디 또는 이메일…'}
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            autoComplete="username"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                        />
                    </div>

                    <div>
                        <label htmlFor="login-password" className="block text-sm font-bold text-ink mb-1.5">비밀번호</label>
                        <input
                            id="login-password"
                            className={inputClass}
                            name="password"
                            placeholder="비밀번호를 입력하세요…"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    </div>

                    {errorMessage && <p className="text-sm text-danger" role="alert">{errorMessage}</p>}

                    <button
                        type="submit"
                        className="h-12 rounded-xl mt-1 font-bold text-on-brand bg-brand shadow-sm hover:brightness-95"
                        disabled={!isEnabled}
                    >
                        {loading ? '로그인 중…' : '로그인'}
                    </button>

                    <div className="flex min-h-11 items-center justify-center text-center text-sm text-sub">
                        아직 계정이 없으신가요?{' '}
                        {isChatSurface ? (
                            <a
                                href={getSocialAppUrl('/signup')}
                                className="inline-flex min-h-11 items-center rounded-lg px-1.5 font-bold text-ink underline decoration-brand decoration-2 underline-offset-4"
                            >
                                SNS에서 회원가입
                            </a>
                        ) : (
                            <button
                                type="button"
                                onClick={() => navigate('/signup')}
                                className="min-h-11 rounded-lg px-1.5 font-bold text-ink underline decoration-brand decoration-2 underline-offset-4"
                            >
                                회원가입
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;
