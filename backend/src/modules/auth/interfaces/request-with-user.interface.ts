import { Request } from 'express';

export interface RequestWithUser extends Request {
  user?:      { id: string; clerkId: string; email: string };
  guestUser?: { id: string; sessionToken: string };
}