import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../index';
import { Role } from '@prisma/client';

// Validation schemas
const registerSchema = z.object({
    phone: z.string().min(9, 'Phone number must be at least 9 characters'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    role: z.enum(['CITIZEN', 'COLLECTOR', 'AGENCY', 'MUNICIPAL']),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
});

const loginSchema = z.object({
    phone: z.string(),
    password: z.string(),
});

export const register = async (req: Request, res: Response) => {
    try {
        const data = registerSchema.parse(req.body);

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { phone: data.phone },
        });

        if (existingUser) {
            return res.status(400).json({ error: 'Phone number already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(data.password, 10);

        // Create user with profile
        const user = await prisma.user.create({
            data: {
                phone: data.phone,
                password: hashedPassword,
                role: data.role as Role,
                profile: {
                    create: {
                        firstName: data.firstName,
                        lastName: data.lastName,
                    },
                },
                // Create wallet for CITIZEN and COLLECTOR roles (recycling module)
                ...((['CITIZEN', 'COLLECTOR'] as Role[]).includes(data.role as Role) && {
                    wallet: {
                        create: {
                            balance: 0,
                        },
                    },
                }),
                // Create reputation score for all users (dump reporting module)
                reputationScore: {
                    create: {
                        score: 0,
                        verifiedReports: 0,
                        falseReports: 0,
                    },
                },
            },
            select: {
                id: true,
                phone: true,
                role: true,
                createdAt: true,
                profile: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });

        // Generate JWT token (100 years expiration as specified)
        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET as string,
            { expiresIn: String(process.env.JWT_EXPIRATION || '876000h') } as any
        );

        res.status(201).json({
            message: 'User registered successfully',
            user,
            token,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.errors });
        }
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const data = loginSchema.parse(req.body);

        // Find user
        const user = await prisma.user.findUnique({
            where: { phone: data.phone },
            include: {
                profile: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
                wallet: {
                    select: {
                        balance: true,
                    },
                },
                reputationScore: {
                    select: {
                        score: true,
                        verifiedReports: true,
                    },
                },
            },
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(data.password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token (100 years expiration)
        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET as string,
            { expiresIn: String(process.env.JWT_EXPIRATION || '876000h') } as any
        );

        // Remove password from response
        const { password, ...userWithoutPassword } = user;

        res.json({
            message: 'Login successful',
            user: userWithoutPassword,
            token,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.errors });
        }
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
};

export const getCurrentUser = async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                id: true,
                phone: true,
                role: true,
                createdAt: true,
                profile: true,
                wallet: {
                    select: {
                        balance: true,
                    },
                },
                reputationScore: {
                    select: {
                        score: true,
                        verifiedReports: true,
                        falseReports: true,
                    },
                },
            },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
};
