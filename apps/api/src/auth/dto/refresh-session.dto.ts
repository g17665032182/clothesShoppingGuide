export type AuthSession = {
  response: {
    accessToken: string;
    user: {
      id: string;
      email: string;
      displayName: string;
      role: 'user' | 'admin';
      status: 'active' | 'disabled';
      createdAt: string;
      updatedAt: string;
    };
  };
  refreshToken: string;
};
