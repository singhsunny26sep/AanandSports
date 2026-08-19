const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const {
  verifyJwtToken,
  validateRoles,
} = require("../middlewares");

const { ROLES } = require("../constants");
const { sendSuccess } = require("../utils");

// =====================================================
// Attendance Model
// =====================================================

const attendanceSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Academy",
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    date: {
      type: String,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["present", "absent"],
      required: true,
    },

    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Prevent duplicate attendance for same student on same day
attendanceSchema.index(
  { academyId: 1, userId: 1, date: 1 },
  { unique: true }
);

const Attendance =
  mongoose.models.Attendance ||
  mongoose.model("Attendance", attendanceSchema);


// =====================================================
// Helper
// =====================================================

const getAcademyId = (req) => {
  // Admin can send academyId
  if (req.role === ROLES.ADMIN) {
    return req.query.academyId || req.body.academyId;
  }

  // Academy manager / staff
  return req.user?.academyId;
};


// =====================================================
// GET ATTENDANCE
//
// GET /aanand-sports/attendance?date=2026-08-19
// =====================================================

router.get(
  "/",
  verifyJwtToken,
  validateRoles(
    ROLES.ADMIN,
    ROLES.ACADEMY_MANAGER,
    ROLES.STAFF
  ),
  async (req, res) => {
    try {
      const date = req.query.date;

      if (!date) {
        return res.status(422).json({
          success: false,
          message: "date is required. Format: YYYY-MM-DD",
        });
      }

      const academyId = getAcademyId(req);

      if (!academyId) {
        return res.status(422).json({
          success: false,
          message: "academyId is required",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(academyId)) {
        return res.status(422).json({
          success: false,
          message: "Invalid academyId",
        });
      }

      // Get all active students of academy
      const User = mongoose.model("User");

      const students = await User.find({
        academyId,
        role: ROLES.USER,
        isDeleted: false,
        isActive: true,
      })
        .select("_id name image")
        .sort({ name: 1 })
        .lean();

      // Get attendance for selected date
      const attendanceRecords = await Attendance.find({
        academyId,
        date,
      })
        .select("userId status")
        .lean();

      const attendanceMap = new Map();

      attendanceRecords.forEach((record) => {
        attendanceMap.set(
          record.userId.toString(),
          record.status
        );
      });

      // Combine students + attendance
      const attendance = students.map((student) => ({
        userId: student._id,
        name: student.name,
        image: student.image || null,

        // If attendance doesn't exist yet,
        // default to absent.
        status:
          attendanceMap.get(student._id.toString()) ||
          "absent",
      }));

      const present = attendance.filter(
        (item) => item.status === "present"
      ).length;

      const absent = attendance.filter(
        (item) => item.status === "absent"
      ).length;

      return sendSuccess(res, 200, "Attendance fetched", {
        date,
        summary: {
          present,
          absent,
          total: attendance.length,
        },
        attendance,
      });
    } catch (error) {
      console.error("GET ATTENDANCE ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch attendance",
        error: error.message,
      });
    }
  }
);


// =====================================================
// SAVE ATTENDANCE
//
// POST /aanand-sports/attendance
// =====================================================

router.post(
  "/",
  verifyJwtToken,
  validateRoles(
    ROLES.ADMIN,
    ROLES.ACADEMY_MANAGER,
    ROLES.STAFF
  ),
  async (req, res) => {
    try {
      const { date, attendance } = req.body;

      if (!date) {
        return res.status(422).json({
          success: false,
          message: "date is required. Format: YYYY-MM-DD",
        });
      }

      if (!Array.isArray(attendance)) {
        return res.status(422).json({
          success: false,
          message: "attendance must be an array",
        });
      }

      const academyId = getAcademyId(req);

      if (!academyId) {
        return res.status(422).json({
          success: false,
          message: "academyId is required",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(academyId)) {
        return res.status(422).json({
          success: false,
          message: "Invalid academyId",
        });
      }

      const User = mongoose.model("User");

      // Get valid students from this academy
      const studentIds = attendance.map(
        (item) => item.userId
      );

      const students = await User.find({
        _id: { $in: studentIds },
        academyId,
        role: ROLES.USER,
        isDeleted: false,
        isActive: true,
      })
        .select("_id")
        .lean();

      const validStudentIds = new Set(
        students.map((student) => student._id.toString())
      );

      const operations = [];

      for (const item of attendance) {
        if (!item.userId) continue;

        if (!validStudentIds.has(item.userId.toString())) {
          continue;
        }

        if (
          item.status !== "present" &&
          item.status !== "absent"
        ) {
          continue;
        }

        operations.push({
          updateOne: {
            filter: {
              academyId,
              userId: item.userId,
              date,
            },

            update: {
              $set: {
                status: item.status,
                markedBy: req.userId,
              },
            },

            upsert: true,
          },
        });
      }

      if (operations.length > 0) {
        await Attendance.bulkWrite(operations);
      }

      // Return updated attendance
      const updatedRecords = await Attendance.find({
        academyId,
        date,
      })
        .populate("userId", "name image")
        .lean();

      const present = updatedRecords.filter(
        (item) => item.status === "present"
      ).length;

      const absent = updatedRecords.filter(
        (item) => item.status === "absent"
      ).length;

      return sendSuccess(res, 200, "Attendance saved successfully", {
        date,
        summary: {
          present,
          absent,
          total: updatedRecords.length,
        },
        attendance: updatedRecords.map((item) => ({
          userId: item.userId?._id,
          name: item.userId?.name,
          image: item.userId?.image || null,
          status: item.status,
        })),
      });
    } catch (error) {
      console.error("SAVE ATTENDANCE ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to save attendance",
        error: error.message,
      });
    }
  }
);

module.exports = router;