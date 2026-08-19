import { z } from 'zod';

/**
 * Имя игрока. Разрешены буквы любого алфавита (RU основной, GDD §10),
 * цифры, дефис и подчёркивание.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(/^[\p{L}\p{N}_-]+$/u);

/**
 * Минимальная длина пароля. Верхняя граница есть намеренно: bcrypt
 * молча обрезает вход на 72 байтах, и пароль без ограничения сверху
 * создаёт ложное ощущение стойкости.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const emailSchema = z.email().max(254);

export const signUpInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
});
export type SignUpInput = z.infer<typeof signUpInputSchema>;

export const signInInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type SignInInput = z.infer<typeof signInInputSchema>;
