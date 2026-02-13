import { Request, Response } from 'express';
import { prisma } from '../index';

/**
 * Get heatmap data for verified dumps
 */
export const getHeatmap = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        let where: any = {
            status: 'VERIFIED',
        };

        // Filter by date range if provided
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate as string);
            }
            if (endDate) {
                where.createdAt.lte = new Date(endDate as string);
            }
        }

        const dumps = await prisma.dumpReport.findMany({
            where,
            select: {
                id: true,
                latitude: true,
                longitude: true,
                size: true,
                status: true,
                createdAt: true,
                _count: {
                    select: {
                        verifications: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Format for heatmap visualization
        const heatmapData = dumps.map(d => ({
            id: d.id,
            lat: d.latitude,
            lng: d.longitude,
            size: d.size,
            status: d.status,
            verifications: d._count.verifications,
            createdAt: d.createdAt,
        }));

        res.json({
            heatmap: heatmapData,
            count: heatmapData.length,
            metadata: {
                startDate: startDate || 'all time',
                endDate: endDate || 'now',
            },
        });
    } catch (error) {
        console.error('Get heatmap error:', error);
        res.status(500).json({ error: 'Failed to fetch heatmap data' });
    }
};

/**
 * Get dump density analytics
 */
export const getDensity = async (req: Request, res: Response) => {
    try {
        const { gridSize } = req.query;
        const gridSizeNum = parseFloat(gridSize as string) || 0.01; // Default ~1km grid

        // Get all verified dumps
        const dumps = await prisma.dumpReport.findMany({
            where: {
                status: 'VERIFIED',
            },
            select: {
                latitude: true,
                longitude: true,
                size: true,
            },
        });

        // Group by grid cells
        const densityMap = new Map<string, any>();

        dumps.forEach(dump => {
            const gridLat = Math.floor(dump.latitude / gridSizeNum) * gridSizeNum;
            const gridLng = Math.floor(dump.longitude / gridSizeNum) * gridSizeNum;
            const key = `${gridLat},${gridLng}`;

            if (!densityMap.has(key)) {
                densityMap.set(key, {
                    lat: gridLat,
                    lng: gridLng,
                    count: 0,
                    sizes: { SMALL: 0, MEDIUM: 0, LARGE: 0 },
                });
            }

            const cell = densityMap.get(key)!;
            cell.count++;
            cell.sizes[dump.size]++;
        });

        const densityData = Array.from(densityMap.values()).sort((a, b) => b.count - a.count);

        res.json({
            density: densityData,
            gridSize: gridSizeNum,
            totalCells: densityData.length,
            totalDumps: dumps.length,
        });
    } catch (error) {
        console.error('Get density error:', error);
        res.status(500).json({ error: 'Failed to fetch density data' });
    }
};

/**
 * Get all verified dumps with filters
 */
export const getVerifiedDumps = async (req: Request, res: Response) => {
    try {
        const { size, status, startDate, endDate } = req.query;

        let where: any = {};

        // Filter by size
        if (size) {
            where.size = size;
        }

        // Filter by status
        if (status) {
            where.status = status;
        } else {
            // Default to verified dumps
            where.status = 'VERIFIED';
        }

        // Filter by date range
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate as string);
            }
            if (endDate) {
                where.createdAt.lte = new Date(endDate as string);
            }
        }

        const dumps = await prisma.dumpReport.findMany({
            where,
            select: {
                id: true,
                latitude: true,
                longitude: true,
                size: true,
                status: true,
                description: true,
                createdAt: true,
                _count: {
                    select: {
                        verifications: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Group by size
        const stats = {
            total: dumps.length,
            bySize: {
                SMALL: dumps.filter(d => d.size === 'SMALL').length,
                MEDIUM: dumps.filter(d => d.size === 'MEDIUM').length,
                LARGE: dumps.filter(d => d.size === 'LARGE').length,
            },
        };

        res.json({
            dumps,
            stats,
            count: dumps.length,
        });
    } catch (error) {
        console.error('Get verified dumps error:', error);
        res.status(500).json({ error: 'Failed to fetch verified dumps' });
    }
};
