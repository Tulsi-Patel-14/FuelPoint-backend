import jwt from 'jsonwebtoken';

export const generateTokens = (userId: string, role: string) => {
  const secretAcc = process.env.JWT_ACCESS_SECRET || 'super-secret-access-key-for-petrol-pump';
  const secretRef = process.env.JWT_REFRESH_SECRET || 'super-secret-refresh-key-for-petrol-pump';
  const expAcc = process.env.JWT_ACCESS_EXPIRES_IN || '30d'; // Increased to 30 days for development
  const expRef = process.env.JWT_REFRESH_EXPIRES_IN || '90d';

  const accessToken = jwt.sign({ sub: userId, role }, secretAcc, { expiresIn: expAcc as any });
  const refreshToken = jwt.sign({ sub: userId, role }, secretRef, { expiresIn: expRef as any });

  return { accessToken, refreshToken };
};
