# Project notes

- This project uses React, TypeScript, and Vite.
- Keep question-bank persistence behind the repository interface in `src/lib/questionBankRepository.ts`.
- Keep each file-format parser in its own module under `src/importers/`. All importers return the unified `ImportResult` shape from `src/importers/types.ts`.
- Keep the import preview step between parsing and saving. Pages should not write imported questions directly to localStorage.
- Keep DeepSeek API calls in `agents/` or `server/`; never import API keys or server agents into React browser code.
- Preserve source answers. Only questions with a missing answer may enter the solver queue.
- Preserve the existing beginner-friendly Chinese comments and avoid adding unnecessary dependencies.

## Post-change development workflow

After every code change, debugging task, or bug fix:

1. Run the relevant automated tests and a production build (`npm run build`) to confirm the project is runnable.
2. If verification fails, report the exact error and do not open a broken page.
3. Check whether the development server is already running. Start it with `npm run dev` only when needed.
4. Read the actual Vite output or probe the running local server to determine the current URL and port; never assume a fixed port.
5. After the server responds successfully, automatically open the current local URL in the user's browser so they can see the latest result.
6. In the final report, always list changed files, test/build results, and the exact URL that was opened.
