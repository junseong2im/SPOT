import { redirectResponse } from '@/lib/google-auth';
export async function POST() { return redirectResponse('/login'); }
