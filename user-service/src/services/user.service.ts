import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { 
  User, 
  CreateUserDTO, 
  UpdateUserDTO, 
  LoginDTO, 
  AuthResponse, 
  TokenPayload,
  PaginationOptions,
  PaginatedResult,
  UserFilter,
  UserStatus
} from '../types/user.types';
import { userRepository } from '../repositories/user.repository';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';

export class UserService {
  async createUser(data: CreateUserDTO): Promise<Omit<User, 'password'>> {
    // Validate unique email
    const existingEmail = await userRepository.findByEmail(data.email);
    if (existingEmail) {
      throw new AppError('Email already exists', 409);
    }

    // Validate unique username
    const existingUsername = await userRepository.findByUsername(data.username);
    if (existingUsername) {
      throw new AppError('Username already exists', 409);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, config.bcrypt.rounds);

    // Create user
    const user = await userRepository.create({
      ...data,
      password: hashedPassword,
    });

    logger.info(`User created: ${user.id}`);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async login(data: LoginDTO): Promise<AuthResponse> {
    // Find user by email
    const user = await userRepository.findByEmail(data.email);
    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    // Check if user is active
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError('Account is not active', 403);
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // Update last login
    await userRepository.updateLastLogin(user.id);

    // Generate token
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(tokenPayload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as jwt.SignOptions);

    logger.info(`User logged in: ${user.id}`);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
    };
  }

  async getUserById(id: string): Promise<Omit<User, 'password'> | null> {
    const user = await userRepository.findById(id);
    if (!user) return null;

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getUserByEmail(email: string): Promise<Omit<User, 'password'> | null> {
    const user = await userRepository.findByEmail(email);
    if (!user) return null;

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async updateUser(id: string, data: UpdateUserDTO): Promise<Omit<User, 'password'>> {
    // Check if user exists
    const existingUser = await userRepository.findById(id);
    if (!existingUser) {
      throw new AppError('User not found', 404);
    }

    // Check email uniqueness if updating email
    if (data.email && data.email !== existingUser.email) {
      const emailExists = await userRepository.findByEmail(data.email);
      if (emailExists) {
        throw new AppError('Email already exists', 409);
      }
    }

    // Check username uniqueness if updating username
    if (data.username && data.username !== existingUser.username) {
      const usernameExists = await userRepository.findByUsername(data.username);
      if (usernameExists) {
        throw new AppError('Username already exists', 409);
      }
    }

    // Update user
    const updatedUser = await userRepository.update(id, data);
    if (!updatedUser) {
      throw new AppError('Failed to update user', 500);
    }

    logger.info(`User updated: ${id}`);

    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async changePassword(id: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify old password
    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid old password', 401);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, config.bcrypt.rounds);

    // Update password
    await userRepository.update(id, { password: hashedPassword });

    logger.info(`Password changed for user: ${id}`);
  }

  async deleteUser(id: string, soft: boolean = true): Promise<void> {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (soft) {
      await userRepository.softDelete(id);
      logger.info(`User soft deleted: ${id}`);
    } else {
      await userRepository.delete(id);
      logger.info(`User permanently deleted: ${id}`);
    }
  }

  async listUsers(
    filter: UserFilter,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<Omit<User, 'password'>>> {
    const result = await userRepository.findAll(filter, pagination);
    
    return {
      ...result,
      data: result.data.map(({ password, ...user }) => user),
    };
  }

  async verifyEmail(userId: string): Promise<void> {
    const user = await userRepository.verifyEmail(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    logger.info(`Email verified for user: ${userId}`);
  }

  async getUserStats(): Promise<any> {
    const total = await userRepository.count();
    const active = await userRepository.count({ status: UserStatus.ACTIVE });
    const verified = await userRepository.count({ emailVerified: true });
    
    return {
      total,
      active,
      inactive: total - active,
      verified,
      unverified: total - verified,
    };
  }

  async verifyToken(token: string): Promise<TokenPayload> {
    try {
      const payload = jwt.verify(token, config.jwt.secret) as TokenPayload;
      return payload;
    } catch (error) {
      throw new AppError('Invalid or expired token', 401);
    }
  }
}

export const userService = new UserService();