import { Router } from 'express';
import {
    reportDump,
    getDumps,
    getDumpById,
    getUserReputation,
} from '../controllers/dumps.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/dumps/report
 * @desc    Submit a dump report with photo
 * @access  All authenticated users
 */
router.post('/report', reportDump);

/**
 * @route   GET /api/dumps
 * @desc    Get all dump reports
 * @access  All authenticated users
 */
router.get('/', getDumps);

/**
 * @route   GET /api/dumps/:id
 * @desc    Get single dump report with full details
 * @access  All authenticated users
 */
router.get('/:id', getDumpById);

/**
 * @route   GET /api/dumps/reputation
 * @desc    Get user reputation score
 * @access  All authenticated users
 */
router.get('/user/reputation', getUserReputation);

export default router;
