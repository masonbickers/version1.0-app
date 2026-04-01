import FitEncoder from "fit-encoder";

/**
 * Generates a FIT workout for a SINGLE session.
 * @param {Object} session - A single session object from your plan
 * @param {String} workoutName
 */
export function generateFitWorkout(session, workoutName = "AI Run Session") {
  const encoder = new FitEncoder({
    forceCRC: true,
    includeRecords: true,
  });

  const segments = Array.isArray(session.segments) ? session.segments : [];
  const workoutSteps = [];

  // 1. Process Segments into FIT-compatible steps
  segments.forEach((seg) => {
    if (seg.isRepeat) {
      const innerSteps = (seg.steps || []).map(s => convertSegment(s));
      // In Garmin: Steps come FIRST, then the Repeat Command
      workoutSteps.push(...innerSteps);
      
      workoutSteps.push({
        isRepeatCommand: true,
        repeatCount: Number(seg.repeatReps || 2),
        numberOfStepsToRepeat: innerSteps.length
      });
    } else {
      workoutSteps.push(convertSegment(seg));
    }
  });

  // 2. Add File ID and Workout Metadata
  encoder.addRecord("file_id", {
    type: "workout",
    manufacturer: "development",
    product: 1,
    serial_number: 12345,
  });

  encoder.addRecord("workout", {
    wkt_name: workoutName.slice(0, 16), // Garmin limit is 16 characters
    sport: "running",
    num_valid_steps: workoutSteps.length,
  });

  // 3. Add Steps
  workoutSteps.forEach((step, index) => {
    if (step.isRepeatCommand) {
      // This is the instruction to loop back
      encoder.addRecord("workout_step", {
        message_index: index,
        duration_type: "repeat_until_steps_cmplt",
        duration_value: workoutSteps.length - step.numberOfStepsToRepeat - 1, // Index to go back to
        target_type: "no_target",
        notes: `Repeat ${step.repeatCount}x`,
        custom_target_value_low: step.repeatCount, // Some devices store repeat count here
      });
    } else {
      encoder.addRecord("workout_step", {
        message_index: index,
        duration_type: step.durationType,
        duration_value: step.durationValue,
        target_type: step.targetType,
        intensity: step.intensity,
        notes: step.notes?.slice(0, 16) || "",
      });
    }
  });

  return encoder.finish();
}

function convertSegment(seg) {
  const isDistance = seg.durationType?.toLowerCase().includes("distance");
  const val = Number(seg.durationValue || 0);

  return {
    durationType: isDistance ? "distance" : "time",
    // Time is in milliseconds, Distance is in centimeters for FIT protocol
    durationValue: isDistance ? val * 100000 : val * 60 * 1000,
    targetType: "no_target",
    intensity: seg.intensityType?.toLowerCase() === "warmup" ? "warmup" : 
               seg.intensityType?.toLowerCase() === "cooldown" ? "cooldown" : "active",
    notes: seg.notes || ""
  };
}