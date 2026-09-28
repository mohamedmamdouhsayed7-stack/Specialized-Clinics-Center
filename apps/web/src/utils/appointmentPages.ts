export interface AppointmentPage<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Fetch every page for date-based calendar views so the last appointments are not hidden. */
export async function collectAppointmentPages<T>(
  fetchPage: (page: number, limit: number) => Promise<AppointmentPage<T>>,
  pageSize = 100,
): Promise<AppointmentPage<T>> {
  const firstPage = await fetchPage(1, pageSize);
  const data = [...firstPage.data];
  let totalPages = firstPage.meta.totalPages;

  for (let page = 2; page <= totalPages; page++) {
    const result = await fetchPage(page, pageSize);
    data.push(...result.data);
    totalPages = Math.max(totalPages, result.meta.totalPages);
  }

  return { ...firstPage, data };
}
