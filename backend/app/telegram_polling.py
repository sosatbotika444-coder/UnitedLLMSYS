from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import BotCommand, BufferedInputFile, KeyboardButton, Message, ReplyKeyboardMarkup

from app.config import get_settings
from app.database import SessionLocal
from app.telegram_bot import (
    BOT_KEYBOARD_ROWS,
    WIZARD_STEPS,
    apply_truck_defaults,
    bot_enabled,
    button_command_alias,
    build_route_bundle,
    clean_text,
    consume_step_input,
    extract_command_argument,
    get_or_create_profile,
    help_message,
    parse_route_pair,
    profile_summary,
    prompt_for_step,
    reset_wizard,
    route_wizard_intro,
    start_repeat_route,
    start_route_wizard,
    status_message,
    truck_binding_label,
    truck_binding_message,
)


settings = get_settings()
router = Router(name="telegram-polling")
dispatcher = Dispatcher()
dispatcher.include_router(router)
logger = logging.getLogger(__name__)
MAX_MESSAGE_LENGTH = 4000


def _message_chunks(text: str, size: int = MAX_MESSAGE_LENGTH) -> list[str]:
    clean = str(text or "").strip()
    if not clean:
        return []
    return [clean[index:index + size] for index in range(0, len(clean), size)]


def _user_payload(message: Message) -> dict:
    user = message.from_user
    return {
        "id": user.id if user else "",
        "username": user.username if user else "",
        "first_name": user.first_name if user else "",
        "last_name": user.last_name if user else "",
    }


def _reply_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=label) for label in row] for row in BOT_KEYBOARD_ROWS],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="Send A -> B or tap a quick action",
    )


async def _answer(message: Message, text: str) -> None:
    await message.answer(text, reply_markup=_reply_keyboard(), disable_web_page_preview=True)


async def _send_bot_message(bot: Bot, chat_id: int, text: str) -> None:
    await bot.send_message(
        chat_id=chat_id,
        text=text,
        reply_markup=_reply_keyboard(),
        disable_web_page_preview=True,
    )


async def _deliver_route_bundle(bot: Bot, chat_id: int, profile_id: int) -> None:
    await bot.send_chat_action(chat_id=chat_id, action="typing")
    try:
        bundle = await asyncio.to_thread(build_route_bundle, profile_id)
    except Exception as exc:
        await _send_bot_message(bot, chat_id, f"{exc}\n\nSend /route and try again.")
        return

    await bot.send_chat_action(chat_id=chat_id, action="upload_photo")
    await bot.send_photo(
        chat_id=chat_id,
        photo=BufferedInputFile(bundle.image_bytes, filename="route-plan.png"),
        caption=(bundle.caption or "")[:1024],
    )
    for chunk in _message_chunks(bundle.details):
        await _send_bot_message(bot, chat_id, chunk)


@router.message(CommandStart())
async def command_start(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        reset_wizard(db, profile)
        response = help_message(profile)
    await _answer(message, response)


@router.message(Command("help"))
async def command_help(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        response = help_message(profile)
    await _answer(message, response)


@router.message(Command("menu"))
async def command_menu(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        reset_wizard(db, profile)
        response = help_message(profile)
    await _answer(message, response)


@router.message(Command("profile"))
async def command_profile(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        response = profile_summary(profile)
    await _answer(message, response)


@router.message(Command("status"))
async def command_status(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        response = status_message(profile)
    await _answer(message, response)


@router.message(Command("truck"))
async def command_truck(message: Message) -> None:
    if message.chat.type != "private":
        return
    truck_number = extract_command_argument(message.text or "")
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        if not truck_number:
            response = f"Use /truck 5188 to bind a truck.\nCurrent binding: {truck_binding_label(profile)}"
        else:
            merged = apply_truck_defaults(db, profile, truck_number)
            response = truck_binding_message(profile, merged)
    await _answer(message, response)


@router.message(Command("reset"))
async def command_reset(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        reset_wizard(db, profile)
    await _answer(message, "Current wizard cleared. Send /route to start again.")


@router.message(Command("route"))
async def command_route(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        start_route_wizard(db, profile)
        response = route_wizard_intro(profile)
    await _answer(message, response)


@router.message(Command("reroute"))
async def command_reroute(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        if not start_repeat_route(db, profile):
            response = "No saved last route yet. Build one with /route first."
        else:
            response = "Last route loaded.\n" + prompt_for_step(profile, "mpg")
    await _answer(message, response)


@router.message()
async def route_message(message: Message, bot: Bot) -> None:
    if message.chat.type != "private":
        return

    text = clean_text(message.text)
    if not text:
        return

    response = ""
    should_build = False
    profile_id = 0

    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        profile_id = int(profile.id)

        alias_command = button_command_alias(text)

        if alias_command == "/help":
            reset_wizard(db, profile)
            response = help_message(profile)
        elif alias_command == "/profile":
            response = profile_summary(profile)
        elif alias_command == "/status":
            response = status_message(profile)
        elif alias_command == "/reset":
            reset_wizard(db, profile)
            response = "Current wizard cleared. Send /route to start again."
        elif alias_command == "/route":
            start_route_wizard(db, profile)
            response = route_wizard_intro(profile)
        elif alias_command == "/reroute":
            if not start_repeat_route(db, profile):
                response = "No saved last route yet. Build one with /route first."
            else:
                response = "Last route loaded.\n" + prompt_for_step(profile, "mpg")
        elif profile.active_step == "building":
            response = "A route is already building. Wait for the result or send /reset."
        else:
            quick_route = parse_route_pair(text)
            if quick_route:
                origin, destination = quick_route
                profile.pending_payload = {"origin": origin, "destination": destination}
                profile.active_step = "mpg"
                db.commit()
                db.refresh(profile)
                response = f"Saved route points: {origin} -> {destination}\n" + prompt_for_step(profile, "mpg")
            elif profile.active_step and profile.active_step in WIZARD_STEPS:
                ok, error_text = consume_step_input(db, profile, text)
                if not ok:
                    response = error_text or "Value is invalid. Try again."
                elif profile.active_step == "building":
                    response = "Building smart route and fuel plan. Please wait..."
                    should_build = True
                else:
                    response = prompt_for_step(profile, profile.active_step)
            else:
                response = "Use the quick buttons below, send /route, or send Point A -> Point B."

    await _answer(message, response)
    if should_build:
        await _deliver_route_bundle(bot, message.chat.id, profile_id)


async def _set_bot_commands(bot: Bot) -> None:
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Open help"),
            BotCommand(command="menu", description="Open quick control panel"),
            BotCommand(command="route", description="Build smart route"),
            BotCommand(command="reroute", description="Reuse the last route"),
            BotCommand(command="status", description="Show current bot status"),
            BotCommand(command="truck", description="Bind truck and sync defaults"),
            BotCommand(command="profile", description="Show saved truck profile"),
            BotCommand(command="reset", description="Reset current wizard"),
            BotCommand(command="help", description="Show help"),
        ]
    )


async def run_polling_bot() -> None:
    if not bot_enabled():
        raise RuntimeError("Telegram bot is disabled. Set TELEGRAM_BOT_ENABLED=true and TELEGRAM_BOT_TOKEN.")

    bot = Bot(
        token=settings.telegram_bot_token,
    )
    await bot.delete_webhook(drop_pending_updates=bool(settings.telegram_polling_drop_pending_updates))
    await _set_bot_commands(bot)
    logger.info("Starting aiogram polling bot")
    await dispatcher.start_polling(bot, allowed_updates=["message"])
