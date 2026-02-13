import { Router } from 'express';
import {
    getHeatmap,
    getDensity,
    getVerifiedDumps,
} from '../controllers/municipal.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// All routes require MUNICIPAL role
router.use(authenticate);
router.use(requireRole('MUNICIPAL'));

/**
 * @route   GET /api/municipal/heatmap
 * @desc    Get heatmap data for verified dumps
 * @access  MUNICIPAL only
 */
router.get('/heatmap', getHeatmap);

/**
 * @route   GET /api/municipal/density
 * @desc    Get dump density analytics
 * @access  MUNICIPAL only
 */
router.get('/density', getDensity);

/**
 * @route   GET /api/municipal/dumps
 * @desc    Get all verified dumps with filters
 * @access  MUNICIPAL only
 */
router.get('/dumps', getVerifiedDumps);

export default router;
