import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { SearchView as SearchViewType } from "./SearchView";

const SearchViewInner = lazy(() =>
  import("./SearchView").then((m) => ({ default: m.SearchView })),
);

type Props = ComponentProps<typeof SearchViewType>;

export function SearchView(props: Props) {
  return (
    <Suspense fallback={null}>
      <SearchViewInner {...props} />
    </Suspense>
  );
}
