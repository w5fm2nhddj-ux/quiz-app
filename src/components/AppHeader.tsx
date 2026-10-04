import { Link } from "react-router-dom";

function BookIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H15a2 2 0 0 0-2 2v16a2 2 0 0 1 2-2h2.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
    </svg>
  );
}

export function AppHeader() {
  return (
    <header className="site-header">
      <Link className="brand" to="/">
        <span className="brand-mark"><BookIcon /></span>
        <span>知点练习</span>
      </Link>
      <nav aria-label="主导航">
        <Link className="nav-link" to="/">我的题库</Link>
      </nav>
    </header>
  );
}
