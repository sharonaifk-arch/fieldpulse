/**
 * Generic data table on TanStack Table: sorting, global search, pagination,
 * column visibility. Presentation only.
 */
import { useState, type ReactNode } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Search } from "lucide-react";
import { Button, Select } from "./ui";

export function DataTable<T>({ data, columns, searchPlaceholder, onRowClick, emptyMessage, initialPageSize = 25, initialSearch, initialHidden }: {
  data: T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  emptyMessage?: ReactNode;
  initialPageSize?: number;
  initialSearch?: string;
  /** colonnes masquées par défaut (réactivables via le sélecteur de colonnes) */
  initialHidden?: string[];
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(initialSearch ?? "");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    Object.fromEntries((initialHidden ?? []).map((id) => [id, false]))
  );
  const [showColumns, setShowColumns] = useState(false);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
    globalFilterFn: "includesString",
  });

  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder ?? "Search…"}
            className="w-full rounded-lg border border-line bg-surface-2 py-1.5 pl-8 pr-3 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-accent"
          />
        </div>
        <div className="relative ml-auto">
          <Button variant="ghost" onClick={() => setShowColumns((v) => !v)}>
            <Columns3 size={14} />
          </Button>
          {showColumns && (
            <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border border-line bg-surface p-2 shadow-[var(--shadow)]">
              {table.getAllLeafColumns().map((col) => (
                <label key={col.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink">
                  <input
                    type="checkbox"
                    checked={col.getIsVisible()}
                    onChange={col.getToggleVisibilityHandler()}
                    className="h-3 w-3 accent-(--accent)"
                  />
                  {typeof col.columnDef.header === "string" ? col.columnDef.header : col.id}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-surface-2/60">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted hover:text-ink"
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" && <ArrowUp size={11} />}
                      {h.column.getIsSorted() === "desc" && <ArrowDown size={11} />}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted">
                  {emptyMessage ?? "—"}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={`border-b border-line last:border-0 ${onRowClick ? "cursor-pointer hover:bg-surface-2/50" : ""}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="whitespace-nowrap px-3 py-2 text-ink">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>
            {table.getFilteredRowModel().rows.length} lignes — page {pageIndex + 1}/{pageCount}
          </span>
          <div className="flex items-center gap-1.5">
            <Select
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}/page
                </option>
              ))}
            </Select>
            <Button variant="ghost" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="ghost" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
