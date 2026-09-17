import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { Link, useRoute } from './lib/router'
import { AuthProvider, useAuth } from './state/AuthContext'
import { ToastProvider } from './state/ToastContext'
import { Ballot } from './pages/Ballot'
import { Control } from './pages/Control'
import { Results } from './pages/Results'
import { SignIn } from './pages/SignIn'
import { Verify } from './pages/Verify'

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ToastProvider>
  )
}

function Shell() {
  const { path } = useRoute()
  const { ready } = useAuth()

  return (
    <Layout>
      {ready ? (
        <Page path={path} />
      ) : (
        <div className="py-16 text-center">
          <Spinner label="Checking the roster and the ballot box" />
        </div>
      )}
    </Layout>
  )
}

function Page({ path }: { path: string }) {
  switch (path) {
    case '/':
      return <SignIn />
    case '/ballot':
      return <Ballot />
    case '/results':
      return <Results />
    case '/verify':
      return <Verify />
    case '/control':
      return <Control />
    default:
      return (
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-3xl">Nothing at this address</h1>
          <p className="mt-2 font-sans text-sm text-ink-60">
            The link may be old, or the stub may have been printed with a typo.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link to="/" className="font-semibold text-pine underline underline-offset-2">
              Sign in
            </Link>
            <Link to="/verify" className="font-semibold text-pine underline underline-offset-2">
              Check a receipt
            </Link>
          </div>
        </div>
      )
  }
}
